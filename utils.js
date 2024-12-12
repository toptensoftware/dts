import ts from 'typescript';

export function isDeclarationNode(node)
{
    switch (node.kind)
    {
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