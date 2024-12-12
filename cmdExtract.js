import fs from 'node:fs';
import ts from 'typescript';
import { find_bol_ws, find_next_line_ws } from '@toptensoftware/strangle';
import { MappedSource } from "@toptensoftware/mapped-source";
import { clargs, showArgs } from "@toptensoftware/clargs";
import { stripComments, parseBlock, replaceInline, formatNamePath } from '@toptensoftware/jsdoc';
import { unindent } from "@toptensoftware/unindent";
import { stripQuotes, stripBlankLines } from "./utils.js";


function showHelp()
{
    console.log("\nUsage: npx toptensoftware/dts extract <dtsfile>");

    console.log("\nOptions:");
    showArgs({
        "<dtsfile>": "The input .d.ts file",
        "    --out:<file>": "Output file (writes to stdout if not specified)",
        "-h, --help":    "Show this help",
    });
}


export function cmdExtract(tail)
{
    let inFile = null;
    let outFile = null;

    let args = clargs(tail);
    while (args.next())
    {
        switch (args.name)
        {
            case "help":
                showHelp();
                process.exit();

            case "out":
                outFile = args.readValue();
                break;

            case null:
                if (inFile == null)
                    inFile = args.readValue();
                else
                    console.error(`Too many arguments: ${args.readValue()}`);
                break;

            default:
                console.error(`Unknown argument: ${args.name}`);
                process.exit(7);
        }
    }


    if (!inFile)
    {
        console.error("missing argument: input file");
        process.exit(7);
    }

    // Read input file
    let source = MappedSource.fromFile(inFile);

    // Parse input file
    let ast = ts.createSourceFile(
        inFile, 
        source.code,
        ts.ScriptTarget.Latest, 
        true, 
    );

    let namepath = "";
    let currentModule = "";
    let allLinks = [];

    // Process all statements
    let sourceFile = process(ast);

    // Check links
    checkLinks();

    let json = JSON.stringify(sourceFile, null, 4);
    if (outFile)
    {
        fs.writeFileSync(outFile, json, "utf8");
    }
    else
    {
        console.log(json);
    }

    function process(node)
    {
        switch (node.kind)
        {
            case ts.SyntaxKind.SourceFile:
                return processSourceFile(node);
            case ts.SyntaxKind.ModuleDeclaration:
                return processModule(node);
            case ts.SyntaxKind.FunctionDeclaration:
                return processFunction(node);
            case ts.SyntaxKind.ClassDeclaration:
                return processClassOrInterface(node, "class");
            case ts.SyntaxKind.InterfaceDeclaration:
                return processClassOrInterface(node, "interface");
            case ts.SyntaxKind.Constructor:
                return processConstructor(node);
            case ts.SyntaxKind.PropertyDeclaration:
                return processProperty(node);
            case ts.SyntaxKind.MethodDeclaration:
            case ts.SyntaxKind.MethodSignature:
                return processMethod(node);
            case ts.SyntaxKind.GetAccessor:
                return processGetAccessor(node);
            case ts.SyntaxKind.SetAccessor:
                return processSetAccessor(node);
            case ts.SyntaxKind.TypeAliasDeclaration:
                return processTypeAlias(node);
            case ts.SyntaxKind.PropertySignature:
                return processPropertySignature(node);
            case ts.SyntaxKind.CallSignature:
                return processCallSignature(node);
                case ts.SyntaxKind.VariableStatement:
                return processVariableStatement(node);
            case ts.SyntaxKind.VariableDeclaration:
                return processVariableDeclaration(node);
        }

        throw new Error(`Don't know how to process node kind: ${node.kind}`);
    }

    function joinNamePath(base, name, sep)
    {
        if (base == "")
            return name;
        else
            return `${base}${sep ?? "."}${name}`;
    }

    function pushNamePath(name, callback)
    {
        let old = namepath;
        namepath = joinNamePath(namepath, name);
        callback();
        namepath = old;
    }

    function postProcessMembers(members)
    {
        for (let i=0; i<members.length; i++)
        {
            if (members[i].kind == "variables")
            {
                let replaceWith = members[i].declarations;
                members.splice(i, 1, ...replaceWith);
                i += replaceWith - 1;
            }
        }
        return members;
    }

    function processSourceFile(node)
    {
        let x = { 
            kind: "source-file",
            members: node.statements.map(x => process(x)),
        }
        return x;
    }
    function processModule(node)
    {
        let saveNamePath = namepath;
        let name = stripQuotes(node.name.getText(ast));
        let previousModule = currentModule;
        currentModule = currentModule == "" ? name : currentModule + "/" + name;
        namepath = `module:${name}`;
        let x = { 
            kind: (node.flags & ts.NodeFlags.Namespace) ? "namespace" : "module",
            name,
            namepath,
            members: postProcessMembers(node.body.statements.map(x => process(x))),
        }
        namepath = saveNamePath;
        currentModule = previousModule;
        return x;
    }

    function processFunction(node)
    {
        return Object.assign({
            kind: "function",
        }, processCommon(node));
    }

    function processClassOrInterface(node, kind)
    {
        let x = Object.assign({
            kind,
        }, processCommon(node));

        pushNamePath(x.name, () => {
            x.members = postProcessMembers(node.members.map(x => process(x)));
        });

        // Combine get/set accessors
        let props = new Map();
        for (let i=0; i<x.members.length; i++)
        {
            let m = x.members[i];
            if (m.kind == "get" || m.kind == "set")
            {
                let key = m.name + (m.static ? "-static" : "");
                let prop = props.get(key);
                if (!prop)
                {
                    prop = {
                        kind: "property",
                        name: m.name,
                        static: m.static,
                        members: [],
                    }
                    props.set(key, prop);
                    x.members.splice(i, 0, prop);
                    i++;
                }

                // Hoist the name path of the accessors on
                // to the property wrapper
                prop.namepath = m.namepath;

                // And qualify the accessor name paths with
                // .get/.set
                m.namepath += "." + m.kind;

                if (m.kind == "get")
                    prop.members.unshift(m);
                else
                    prop.members.push(m);
                x.members.splice(i, 1);
                i--;
            }
        }

        return x;
    }

    function processProperty(node)
    {
        let x = Object.assign({
            kind: "property",
        }, processCommon(node, true));
        return x;
    }

    function processConstructor(node)
    {
        let x = Object.assign({
            kind: "constructor",
        }, processCommon(node, true));
        return x;
    }

    function processMethod(node)
    {
        let x = Object.assign({
            kind: "method",
        }, processCommon(node, true));
        return x;
    }

    function processGetAccessor(node)
    {
        let x = Object.assign({
            kind: "get",
        }, processCommon(node, true));
        return x;
    }

    function processSetAccessor(node)
    {
        let x = Object.assign({
            kind: "set",
        }, processCommon(node, true));
        return x;
    }

    function processTypeAlias(node)
    {
        let x = Object.assign({
            kind: "type-alias",
        }, processCommon(node, false));

        if (node.type.members)
        {
            pushNamePath(x.name, () => {
                x.members = node.type.members.map(x => process(x));
            });
        }

        return x;
    }

    function processPropertySignature(node)
    {
        let x = Object.assign({
            kind: "property",
        }, processCommon(node, true));
        return x;
    }

    function processCallSignature(node)
    {
        let x = Object.assign({
            kind: "call-signature",
            name: "(call signature)",
        }, processCommon(node, true));
        return x;
    }

    function processVariableStatement(node)
    {
        if (node.declarationList.declarations.length != 1)
        {
            console.error(`warning: ${format_position(node)}: multi-variable statements not support`);
        }

        let declNode = node.declarationList.declarations[0];

        let x = Object.assign(
            {
                kind: "variable",
            }, 
            processCommon(declNode, false),
            processCommon(node, false)
        );

        return x;

        /*
        // This is a temporary placeholder and will be
        // flattened by postProcessMembers later
        let x = Object.assign({
            kind: "variables",
            declarations: node.declarationList.declarations.map(x => process(x)),
        }, processCommon(node, false));
        return x;
        */
    }

    function processVariableDeclaration(node)
    {
        let x = Object.assign({
            kind: "let",
        }, processCommon(node, false));
        return x;
    }

    function processCommon(node, isMember)
    {
        let common = {};

        // Capture static flag
        let modifiers = ts.getCombinedModifierFlags(node);
        if (modifiers & ts.ModifierFlags.Static)
        {
            common.static = true;
        }

        // Get item name
        if (node.kind == ts.SyntaxKind.Constructor)
        {
            common.name = "constructor";
        }
        else if (node.name)
        {
            common.name = node.name.getText();
        }

        // Name path
        if (common.name)
        {
            if (isMember)
                common.namepath = joinNamePath(namepath, common.name, common.static ? "." : "#");
            else
                common.namepath = joinNamePath(namepath, common.name, ".");
        }

        // Capture definition
        common.definition = unindent(stripBlankLines(stripComments(source.code.substring(
            find_bol_ws(source.code, node.getStart(ast)),
            find_next_line_ws(source.code, node.end)
        )))).trimEnd();

        // Capture leading comments
        let documented = false;
        let comments = ts.getLeadingCommentRanges(source.code, node.pos);
        if (comments && comments.length > 0)
        {
            // Get the immediately preceeding comment block
            let comment = comments[comments.length-1];
            let commentPos = find_bol_ws(source.code, comment.pos);
            let commentText = source.code.substring(
                commentPos,
                find_next_line_ws(source.code, comment.end)
            );

            // Replace inline Jsdoc directives
            let linked = replaceInline(commentText);
            linked.links.forEach(x => {

                // Update link position relative to document
                x.pos += commentPos;
                x.end += commentPos;

                // Qualify name paths with the current module name
                if (x.namepath && x.namepath[0].prefix != "module:")
                {
                    x.namepath.unshift({
                        prefix: "module:",
                        name: currentModule,
                    });
                    x.namepath[1].delim = ".";
                }

                // Store link for later checking
                allLinks.push(x);
            });

            // Parse JSDoc comments
            common.jsdoc = parseBlock(linked.body);
            common.links = linked.links;

            // Track documented
            documented = !!common.jsdoc;

            // Display warnings for any parameter documentation mismatches
            if (documented && node.parameters)
            {
                let parameterNames = node.parameters.map(x => x.name.getText(ast));
                let parameterBlocks = common.jsdoc.filter(x => x.block == "param");
                for (let i=0; i<parameterBlocks.length; i++)
                {
                    if (!parameterNames.some(x => x == parameterBlocks[i].name))
                    {
                        console.error(`warning: ${format_position(node)}: @param block for unknown parameter '${parameterBlocks[i].name}'`);
                    }
                }
                for (let i=0; i<parameterNames.length; i++)
                {
                    if (!parameterBlocks.some(x => x.name == parameterNames[i]))
                    {
                        console.error(`warning: ${format_position(node)}: missing @param description for '${parameterNames[i]}'`);
                    }
                }
            }
        }

        // Display a warning if no documentation
        if (!documented && 
            node.kind != ts.SyntaxKind.VariableStatement &&
            node.kind != ts.SyntaxKind.VariableDeclaration
            )
        {
            let name = node.name?.getText(ast) ?? "<unnamed element>";
            console.error(`warning: ${format_position(node)}: no documentation for ${name}`);
        }

        return common;

    }

    function format_position(node)
    {
        let pos = node.name ? node.name.getStart(ast) : node.getStart(ast);
        let lp = source.fromOffset(pos);
        return `${lp.source}:${lp.line}:${lp.column}`;
    }

    function resolveNamePath(node, namepath)
    {
        for (let n of namepath)
        {
            if (n.delimiter == "~")
                return null;

            if (!node.members)
                return null;

            let subNode = null;
            for (let m of node.members)
            {
                if (n.prefix == "module:" && m.kind != "module")
                    continue;
                if (n.delimiter == '#' && node.static)
                    continue;
                if (m.name != n.name)
                    continue;
                subNode = m;
                break;
            }
            if (!subNode)
                return null;
            node = subNode;
        }
        return node;
    }

    function checkLinks()
    {   
        for (let l of allLinks)
        {
            if (!l.namepath)
                continue;
            if (!resolveNamePath(sourceFile, l.namepath))
            {
                let lp = source.fromOffset(l.pos);
                console.error(`warning: ${lp.source}:${lp.line}:${lp.column}: unresolved namepath: ${formatNamePath(l.namepath)}`);
            }
            l.namepath = formatNamePath(l.namepath);
        }
    }
}

