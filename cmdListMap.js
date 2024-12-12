import { clargs, showArgs } from "@toptensoftware/clargs";
import { MappedSource } from "@toptensoftware/mapped-source";

function showHelp()
{
    console.log("\nUsage: npx toptensoftware/dts list-map <file>");

    console.log("\nLists the contents of a source map");

    console.log("\nOptions:");
    showArgs({
        "<file>": "Any source file with associated .map",
        "-h, --help":    "Show this help",
    });
}


export function cmdListMap(tail)
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

    // List mappings
    sourceFile.sourceMap.eachMapping(x => {
        console.log(`${x.generatedLine}:${x.generatedColumn} => ${x.source}:${x.originalLine}:${x.originalColumn} "${x.name}"`);
    });
}

