# dts

`dts` is a tool that tries to fix the generated `.d.ts` files 
produced by the TypeScript compiler when parsing `.js` files.

`dts` is designed primarily for producing clean `.d.ts` files 
for JavaScript libraries.  The produced `.d.ts` files are suitable
for IntelliSense in VScode and as a starting point for generating 
documention for the public API of a library.


## Background

Let's say you have a JavaScript library and you want to generate the
`.d.ts` file that drives VS Codes IntelliSense.  You can use use
the TypeScript compiler to produce the `.d.ts` and it'll glean quite
a bit of information both from the code itself and from JSDoc comments.  

That's great, but there's some issues...

Suppose your library is configured like this pretty typical setup:

`index.js`, the main entry point into library:

```js
export * from "./foo.js";
export * from "./bar.js";
```

`foo.js`:

```js
/** This is the foo function */
export function foo()
{
}
```

and `bar.js`:

```js
/** This is the bar function */
export function bar()
{
}
```

To generate the `.d.ts` file you can setup a `tsconfig.json` like this:

```json
{
  "include": [
    "index.js",
  ],
  "compilerOptions": {
    "allowJs": true,
    "declaration": true,
    "emitDeclarationOnly": true,
    "outFile": "index.d.ts",
    "declarationMap": true,
  }
}
```

and run `tsc --project tsconfig.json` and it will produce an 
`.d.ts` file:

```typescript
declare module "foo" {
    /** This is the foo function */
    export function foo(): void;
}
declare module "bar" {
    /** This is the bar function */
    export function bar(): void;
}
declare module "index" {
    export * from "foo";
    export * from "bar";
}
//# sourceMappingURL=index.d.ts.map
```

The main problem with the above is it has wrapped exports from
each .js file into a module declaration - rather than producing
a module for the library/package as a whole.

This causes weird behaviour in VS Code.  For example, when 
automatically adding imports, VS Code adds:

```js
import { foo } from "foo";
```

What we really want is it to add the package name of the library:

```js
import { foo } from "@myscope/mylib";
```


To do this, we need a `.d.ts` file like this:

```typescript
declare module "@myscope/mylib" {
    /** This is the foo function */
    export function foo(): void;

    /** This is the bar function */
    export function bar(): void;
}
```

There's other problems too:

* The `tsc` compiler is supposed to be able to omit declarations
  marked as `@internal` - but it doesn't work for .js files.

* The produced file includes private declarations and and classes
  with private fields acquire a new field named `#private`.

* The generated file includes all internally referenced modules
  and not just those that are explicitly exported - ie: the 
  library's internal workings are unnecessarily exposed.

* The source map generated by `tsc` isn't great. VS Code's Jump 
  to Definition command will often jump to the first JSDoc `@param` 
  definition of a function instead of the actual function.



## The Solution (Maybe)

`dts` tries to sort this out.  

Start by generating a `.d.ts` file as described above.  Next, feed
the produced file into `dts`:

```
npx toptensoftware/dts flatten @myscope/mylib index.d.ts --module:index
```

The three arguments are:

* `@myscope/mylib` - the name of the module to produce (typically 
  the package name of the library)
* `index.d.ts` - the file to process (as produced by `tsc`)
* `index` - the name of the root module whose exports are to be
  flattened.

This will:

* Start with the specified module `index`, read all its exports
  and recursively flatten them all into a single module
* Ignore anything not recursively exported by the `index` module
* Wrap the exports in a module with the specified package name
* Remove any `import` and `export` statements that are no longer 
  required because everything is now one big happy module
* Fix the source map so it works correcly VS Code's jump to 
  definition
* Remove any private and internal declarations
* Overwrite the original `index.d.ts` with the newly generated
  file.  Use `--out:<file>` to write to a different file


## Mixing TypeScript Declarations

If you have additional types that are declared in TypeScript
that you want to mix in with your JavaScript declared types
you can pass multiple `.d.ts` files.

eg: suppose you had a file `types.d.ts` that declared additional
type information not listed in the .js files of the library.

```ts
declare module "types" {
    export interface IMyInterface 
    {
        // etc...
    }
}
```

The following command could be used merge the `index` module and 
`types` modules from the two `.d.ts` files into a single `.d.ts`
file for the package as a whole:

```
npx toptensoftware/dts flatten @myscope/mylib index.d.ts types.d.ts --module:index --module:types
```


## Extracting JSON

Once you have the final `.d.ts` file you can feed it into
documentation generators like `typedoc`, `tsdoc` etc...

Alternatively, if you want to generate documentation yourself
`dts` can produce a simple JSON file with just enough information 
to produce documentation.

```
npx toptensoftware/dts extract ../core/index.d.ts --out:index.d.json
```

YMMV: the code that produces the JSON is only aware of certain
typescript constructs - primarily those that can be produced
by JSDocs.  There are definitely gaps in what it supports. 

At least the following aren't supported:

* Deconstructed function arguments
* Type parameters
* Probably more...

That said, if your producing fairly standard .js code, it's 
possible the above will work just fine.



## Other Commands

`dts` has a few other commands, mainly related to inspecting 
source maps.  Run with `--help` to see some other commands.


## Related StackOverflow Question

Question asked here:

https://stackoverflow.com/questions/79253449/how-to-correctly-generate-d-ts-files-for-library-package