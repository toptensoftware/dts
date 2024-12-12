#!/usr/bin/env node

import path from 'node:path';
import url from 'node:url';
import { clargs, showPackageVersion, showArgs } from "@toptensoftware/clargs";
import { cmdFlatten } from "./cmdFlatten.js";
import { cmdExtract } from "./cmdExtract.js";
import { cmdList } from "./cmdList.js";
import { cmdListMap } from "./cmdListMap.js";
import { cmdMapPosition } from "./cmdMapPosition.js";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

function showVersion()
{
    showPackageVersion(path.join(__dirname, "package.json"));
}

function showHelp()
{
    showVersion();

    console.log("\nUsage: npx toptensoftware/dts <command> [args...]");

    console.log("\nOptions:");
    showArgs({
        "<command>":     "Command to execute",
        "-v, --version": "Show version info",
        "-h, --help":    "Show this help",
    });

    console.log("\nCommand:");
    showArgs({
        "flatten": "Flattens the exports of a module",
        "extract": "Creates .json file describing the file contents",
        "list": "List the declarations and positions in a .d.ts file",
        "list-map": "List the contents of a .map file",
        "map-position": "Map one or more source positions to original positions",

    });

    console.log("\nRun 'dts <cmd> --help' for command specific help.");
}


let args = clargs();
while (args.next())
{
    switch (args.name)
    {
        case "version":
            showVersion();
            process.exit(0);

        case "help":
            showHelp();
            process.exit(0);

        case null:
            switch (args.readValue())
            {
                case "flatten":
                    cmdFlatten(args.readTail());
                    break;

                case "extract":
                    cmdExtract(args.readTail());
                    break;

                case "list":
                    cmdList(args.readTail());
                    break;

                case "list-map":
                    cmdListMap(args.readTail());
                    break;

                case "map-position":
                    cmdMapPosition(args.readTail());
                    break;


            }
            break;

        default:
            console.error(`Unknown argument: ${args.name}`);
            process.exit(7);
    }
}

