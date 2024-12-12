import { clargs, showArgs } from "@toptensoftware/clargs";
import { MappedSource } from "@toptensoftware/mapped-source";

function showHelp()
{
    console.log("\nUsage: npx toptensoftware/dts map-position <file> <line>[:<col>]...");

    console.log("\nOptions:");
    showArgs({
        "<file>": "Any source file with associated .map",
        "<line>": "Line number to look up",
        "<col>": "Column number to look up",
        "-h, --help":    "Show this help",
    });
}


export function cmdMapPosition(tail)
{
    let file = null;
    let positions = [];
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
                {
                    file = args.readValue()
                }
                else
                {
                    let parts = args.readValue().split(":");
                    if (parts.length == 1)
                    {
                        positions.push({ 
                            line: parseInt(parts[0]), column: 0 
                        });
                    }
                    else if (parts.length == 2)
                    {
                        positions.push({
                            line: parseInt(parts[0]), 
                            column: parseInt(parts[1]) 
                        });
                    }
                    else
                        throw new Error("Invalid line:col value");
                }
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

    for (let pos of positions)
    {
        let op = sourceFile.sourceMap.originalPositionFor(pos);
        console.log(`${file}:${pos.line}:${pos.column} => ${op.source}("${op.name}"):${op.line}:${op.column}`);
    }
}