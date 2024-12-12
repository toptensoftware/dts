import path from 'node:path';
import ts from 'typescript';
import { MappedSource, EditableMappedSource } from "@toptensoftware/mapped-source";
import { find_bol_ws, find_next_line_ws } from '@toptensoftware/strangle';
import { clargs, showArgs } from "@toptensoftware/clargs";
import { isDeclarationNode, getExportName, stripQuotes, isPrivateOrInternal} from "./utils.js";
import { remapSymbols } from './remapSymbols.js';


function showHelp()
{
    console.log("\nUsage: npx toptensoftware/dts flatten <modulename> <dtsfile>... ");

    console.log("\nOptions:");
    showArgs({
        "<moduleName>": "The module name of the resulting flattened .d.ts file",
        "<dtsfile>": "The input .d.ts file (or files)",
        "--module:<module>": "The name of the module to export (defaults to last in file)",
        "-h, --help":    "Show this help",
    });

    console.log(`
Flattens the export definitions in a .d.ts file into 
single module.  Typical use case is for fixing up the files 
produced by tsc when extracting the definitions from JS code.

Also removes an self referencing imports, redundant exports,
unneeded @typedef and @callback comment blocks, @internal and
private declarations.

If input file has a source map, new updated map is generated.
`);
}


export function cmdFlatten(tail)
{
    let inFiles = [];
    let outFile = null;
    let moduleName = null;
    let rootModules = [];

    let args = clargs(tail);
    while (args.next())
    {
        switch (args.name)
        {
            case "help":
                showHelp();
                process.exit();

            case "module":
                rootModules.push(args.readValue());
                break;

            case "out":
                outFile = args.readValue();
                break;

            case null:
                if (moduleName == null)
                    moduleName = args.readValue();
                else
                    inFiles.push(args.readValue());
                break;

            default:
                console.error(`Unknown argument: ${args.name}`);
                process.exit(7);
        }
    }

    if (!moduleName)
    {
        console.error("missing argument: module name");
        process.exit(7);
    }
    
    if (!inFiles.length)
    {
        console.error("missing argument: input files");
        process.exit(7);
    }

    // Must have some modules to flatten
    if (rootModules.length == 0)
    {
        console.error("missing argument: no module names specified");
        process.exit(7);
    }
 
    // Process input files
    let moduleList = [];
    for (let inFile of inFiles)
    {
        // Read input file
        let source = MappedSource.fromFile(inFile);

        // Parse input file
        let ast = ts.createSourceFile(
            inFile, 
            source.code,
            ts.ScriptTarget.Latest, 
            true, 
        );

        // Remap symbols to fix up tsc's messy symbol map
        let ms = remapSymbols(source, ast);

        // Process statements
        moduleList.push(processModuleStatements(inFile, ms, ast.statements, true));
    }

    // Build the full module map
    let moduleMap = new Map();
    moduleList.forEach(x => buildModuleMap(x));

    // Recursively resolve all `export ... from "module"`
    moduleList.forEach(x => resolveExportDeclarations(x));

    // Build the final set of exports
    let finalExportList = new Set();
    for (let rm of rootModules)
    {
        let mod = getModule(rm);
        if (!mod)
            throw new Error(`Root module '${rm}' not found.`);
        mod.resolvedExports.forEach(x => finalExportList.add(x))
    }

    // Write new file
    let msOut = new EditableMappedSource();
    msOut.append(`declare module "${moduleName}" {\n`);
    Array.from(finalExportList).forEach(x => writeExport(msOut, x));
    msOut.append(`\n}\n`);
    msOut.save(outFile ?? inFiles[0]);

    // Process the statements of either a top level source file, or 
    // a module declaration block.
    function processModuleStatements(modulename, ms, statements, isSourceFile)
    {
        let exports = [];
        let modules = [];
        for (let node of statements)
        {
            let name = getExportName(node);
            if (name)
            {
                // Get the immediately preceding comment
                let startPos = node.getStart();
                let comments = ts.getLeadingCommentRanges(ms.code, node.pos);
                if (comments && comments.length > 0)
                {
                    startPos = comments[comments.length - 1].pos;
                }

                // Work out the full range of text
                let pos = find_bol_ws(ms.code, startPos);
                let end = find_next_line_ws(ms.code, node.end);

                // Extract it
                let definition = ms.substring(pos, end);

                exports.push({
                    name, 
                    node,
                    originalPosition: pos,
                    definition,
                    source: ms,
                });
            }
            else if (ts.isExportDeclaration(node))
            {
                // Get the module name
                let moduleSpecifier = stripQuotes(node.moduleSpecifier.getText());

                if (node.exportClause)
                {
                    symbols = [];
                    for (let e of node.exportClause.elements)
                    {
                        if (e.propertyName)
                        {
                            console.error(`Renaming exports not supported, ignoring "${e.getText()}" in ${module.name.getText()}`);
                        }
                        exports.push({
                            name: e.name.getText(),
                            from: moduleSpecifier,
                        });
                    }
                }
                else
                {
                    exports.push({
                        name: "*",
                        from: moduleSpecifier
                    });
                }
            }
            else if (ts.isModuleDeclaration(node))
            {
                // Get the module name
                let name = stripQuotes(node.name.getText());

                // Nested module name?
                if (!isSourceFile)
                    name = moduleName + "/" + name;

                // Process module statements
                modules.push(processModuleStatements(name, ms, node.body.statements, false));
            }
        }

        return { 
            name: modulename, 
            exports, 
            modules 
        }
    }

    function buildModuleMap(module)
    {
        moduleMap.set(module.name, module);
        for (let m of module.modules)
        {
            buildModuleMap(m);
        }
    }

    function getModule(moduleName)
    {
        // Get the module
        let module = moduleMap.get(moduleName);
        if (!module)
            module = moduleMap.get(moduleName + "/index");
        if (!module)
            module = moduleMap.get(moduleName + ".d.ts");
        if (!module)
        {
            console.error(`warning: unknown module: ${moduleName}`)
            return null;
        }
        return module;
    }

    function resolveExportDeclarations(module)
    {
        if (module.resolvedExports)
            return;
        module.resolvedExports = []; // prevent re-entry

        // Resolve submodules
        for (let m of module.modules)
            resolveExportDeclarations(m);

        let resolvedExports = new Set();
        for (let e of module.exports)
        {
            // Already defined?
            if (e.definition)
            {
                resolvedExports.add(e);
            }
            else
            {
                // Find definition in another module
                let importFromModule = getModule(e.from);
                if (!importFromModule)
                    continue;
                
                // Make sure it's resolved
                resolveExportDeclarations(importFromModule);

                if (e.name == "*")
                {
                    for (let e of importFromModule.resolvedExports)
                    {
                        resolvedExports.add(e);
                    }
                }
                else
                {
                    let e = importFromModule.resolveExports.findIndex(x => x.name == e.name);
                    if (e)
                    {
                        resolvedExports.add(e);
                    }
                    else
                    {
                        console.error(`warning: couldn't find export '${e.name}' in '${e.from}'`);
                    }
                }
            }
        }

        module.resolvedExports = Array.from(resolvedExports);
    }

    function writeExport(out, declaration)
    {
        // Ignore if internal
        if (isPrivateOrInternal(declaration.node))
            return;

        let ms = declaration.source;

        // Clean up the declaration
        let deletions = [];
        ts.forEachChild(declaration.node, walk);
        deletions.sort((a,b) => b.pos - a.pos);
        let prev = null;
        for (let d of deletions)
        {
            // Sanity check no overlapping ranges
            if (prev && d.end > prev.pos)
                throw new Error("overlapping delete ranges");
            prev = d;

            declaration.definition.delete(
                d.pos - declaration.originalPosition,
                d.end - d.pos
            );
        }

        // Write it
        out.append(declaration.definition);

        // Delete a node and 1x preceding comment block
        function deleteNode(node)
        {
            let pos = node.getStart();
            let comments = ts.getLeadingCommentRanges(ms.code, node.pos);
            if (comments && comments.length > 0)
                pos = comments[comments.length-1].pos;

            pos = find_bol_ws(ms.code, pos);
            let end = find_next_line_ws(ms.code, node.end);
            deletions.push({ pos, end });
        }
    
        function walk(node)
        {
            if (isDeclarationNode(node))
            {
                // Delete #private fields and anything starting with _
                if (node.name)
                {
                    let name = node.name.getText();
                    if (name == "#private" || name.startsWith("_"))
                    {
                        deleteNode(node);
                        return;
                    }
                }

                // Delete anything marked @internal or @private
                if (isPrivateOrInternal(node))
                {
                    deleteNode(node);
                    return;
                }
            }
            
            if (ts.isImportTypeNode(node))
            {
                // Remove: import(<knownmodule>).
                let importedModule = getModule(stripQuotes(node.argument.getText()));
                if (importedModule)
                {
                    let typeName = node.qualifier.getText();
                    if (importedModule.resolvedExports.some(x => x.name == typeName))
                    {
                        let pos = node.pos;
                        while (ms.code[pos] == ' ')
                            pos++;
                        let text = ms.code.substring(pos, node.qualifier.pos);

                        // Track for deletion
                        deletions.push({
                            pos: pos,
                            end: node.qualifier.pos,
                        })
                    }
                }
            }
            ts.forEachChild(node, walk);
        }
    }
}


