import ts from 'typescript';

export function isDeclarationNode(node)
{
    switch (node.kind)
    {
        case ts.SyntaxKind.Constructor:
        case ts.SyntaxKind.PropertyDeclaration:
        case ts.SyntaxKind.MethodDeclaration:
        case ts.SyntaxKind.VariableDeclaration:
        case ts.SyntaxKind.FunctionDeclaration:
        case ts.SyntaxKind.ClassDeclaration:
        case ts.SyntaxKind.InterfaceDeclaration:
        case ts.SyntaxKind.TypeAssertionExpression:
        case ts.SyntaxKind.EnumDeclaration:
        case ts.SyntaxKind.GetAccessor:
        case ts.SyntaxKind.SetAccessor:
            return true;
    }
    return false;
}


export function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
}


export function getExportName(node)
{
    if (node.name && (ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Export) != 0)
        return node.name.getText();

    if (node.kind == ts.SyntaxKind.VariableStatement)
    {
        if (node.declarationList?.declarations?.length === 1)
        {
            let declNode = node.declarationList.declarations[0];
            return getExportName(declNode);
        }
        else if (node.declarationList.declarations.some(x => getExportName(x)))
            throw new Error("Multi-variable exports not supported");
    }
    return null;
}

export function stripQuotes(str)
{
    if ((str.startsWith("\"") && str.endsWith("\"")) ||
        (str.startsWith("\'") && str.endsWith("\'")))
        str = str.substring(1, str.length - 1);
    return str;
}

export function isPrivateOrInternal(node)
{
    if ((ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Private) != 0)
        return true;
    if (ts.isInternalDeclaration(node))
        return true;

    return false;
}

export function stripBlankLines(string)
{
    return string.replace(/^\s*\n/gm, "")
}

export function extractImportInfo(node) 
{
    // Module specifier: the string after "from" (strip quotes just in case)
    const moduleSpecifier = node.moduleSpecifier.text.replace(/^["']|["']$/g, '');

    // Default import: import name from "module"
    const defaultImport = node.importClause?.name?.text;

    // Named imports: import { name1, name2 } from "module"
    const namedImports = [];
    if (node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings)) 
    {
        node.importClause.namedBindings.elements.forEach(element => {

            // Check for renamed imports (propertyName exists when using "as")
            if (element.propertyName) 
                throw new Error(`Renamed imports are not supported: "import { ${element.propertyName.text} as ${element.name.text} } from "${moduleSpecifier}"`);

            // Add to set
            namedImports.push(element.name.text);

        });
    }
  
    return { moduleSpecifier, defaultImport, namedImports };
}

export function mergeImportInfo(target, source)
{
    // Merge default import
    if (source.defaultImport)
    {
        // Check same name used
        if (target.defaultImport != null && target.defaultImport != source.defaultImport)
            throw new Error(`Default import from '${target.moduleSpecifier}' used with differen tnames`);
        target.defaultImport = source.defaultImport;
    }

    // Merge named imports
    for (let ni in source.namedImports)
    {
        // Add if not already included
        if (target.namedImports.indexOf(ni) < 0)
            target.namedImports.push(ni);
    }
}

export function renderImportInfo(info)
{
    let importStr = 'import ';
  
    if (info.defaultImport)
        importStr += info.defaultImport;
  
    if (info.namedImports.length > 0) 
    {
        if (info.defaultImport) 
            importStr += ', ';
        importStr += `{ ${info.namedImports.join(', ')} }`;
    }
  
  importStr += ` from "${info.moduleSpecifier}";`;
  return importStr;
}