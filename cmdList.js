import ts from 'typescript';
import { clargs, showArgs } from "@toptensoftware/clargs";
import { MappedSource } from "@toptensoftware/mapped-source";
import { isDeclarationNode } from './utils.js';

function showHelp()
{
    console.log("\nUsage: npx toptensoftware/dts demod <dtsfile> <modulename>");

    console.log("\nOptions:");
    showArgs({
        "<dtsfile>": "The input .d.ts file (will be overwritten)",
        "<moduleName>": "The module name of the resulting collapsed .d.ts file",
        "--strip-internal": "Strip declarations marked @internal",
        "-h, --help":    "Show this help",
    });

    console.log(`
Collapses multiple module definitions in a .d.ts file into 
single module.  Typical use case is for fixing up the files 
produced by tsc when extracting the definitions from JS code.

Also removes an self referencing imports, redundant exports,
unneeded @typedef and @callback comment blocks.  Can also
remove declarations marked @internal (use --strip-internal).

If input file has a source map, new updated map is generated.
`);
}


export function cmdList(tail)
{
    let file = null;
    let args = clargs(tail);
    while (args.next())
    {
        switch (args.name)
        {
            case "help":
                showHelp();
                process.exit();

            case null:
                if (file == null)
                    file = args.readValue();
                else
                    console.error(`Too many arguments: ${args.readValue()}`);
                break;

            default:
                console.error(`Unknown argument: ${args.name}`);
                process.exit(7);
        }
    }

    // Check args
    if (!file)
    {
        console.error("missing argument: input file");
        process.exit(7);
    }
    
    // Load source file
    let sourceFile = MappedSource.fromFile(file);

    // Parse input file
    let ast = ts.createSourceFile(
        file, 
        sourceFile.code,
        ts.ScriptTarget.Latest, 
        true, 
    );

    // List all definitions
    let moduleName = "";
    ts.forEachChild(ast, list_definitions);

    function list_definitions(node)
    {
        if (ts.isModuleDeclaration(node))
        {
            moduleName = node.name.getText(ast);
            console.log(`${moduleName}`);
            ts.forEachChild(node, list_definitions);
            moduleName = "";
            return;
        }
        else if (isDeclarationNode(node))
        {
            if (node.name)
            {
                let name = node.name.getText(ast);
                let pos = "";
                if (sourceFile.sourceMap)
                {
                    let namepos = node.name.getStart(ast);
                    let lp = sourceFile.lineMap.fromOffset(namepos);
                    let lpo = sourceFile.sourceMap.originalPositionFor(lp);
                    pos = `${file}:${lp.line}:${lp.column} => ${lpo.source}:${lpo.line}:${lpo.column}`;
                }
                console.log(`  ${name}: ${pos}`);
            }
        }
        ts.forEachChild(node, list_definitions);
    }
}
