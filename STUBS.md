# Typed stub semantics

A decomposition is `SKETCH_ACCEPTED` the moment it is submitted: the parent's
files are written against children that nobody has implemented yet
(PROTOCOL.md, *Decomposition*). In Lean the thing you build against is a
`sorry`-stubbed statement. In software it has to be a real artifact — a module
the parent can import, and, in a typed language, a declaration the compiler can
check the parent's call sites against.

That artifact is a **stub**. It is generated, never hand-written, from the one
immutable source of truth for the child: the contract's `interface`.

## The stub block

A contract that is meant to be stubbed carries a fenced ` ```stub ` block
inside its `interface`. The prose around it stays the human half; the block is
the machine-readable half:

    Two pure string functions: `greet` renders a polite line for a name,
    `shout` an upper-case one.

    ```stub
    export function greet(name: string): string;
    export function shout(name: string): string;
    ```

Grammar, deliberately one line per symbol:

- `export function <name>(<params>): <type>;` — TypeScript declaration syntax.
- Blank lines and `//` comment lines are ignored; anything else is an error
  that names the contract and the offending line.
- Asynchronous symbols are declared by their return type (`Promise<T>`), not by
  an `async` keyword: `.d.ts` has no such keyword.
- Function declarations only. A `const` export cannot throw when it is read, so
  a value that does not exist yet is declared as an accessor function instead.

Contracts are immutable, so the block cannot be retrofitted to a contract that
was published without one (`contracts/add.json` and friends). Such a contract is
stubbed by hand, or superseded by a successor that carries a block.

## Generating stubs

```sh
node tools/stub.mjs <contract> [--dir p] [--format mjs|dts] [--out file] [--check]
```

- `<contract>` is a contract *name*, resolved to `<dir>/contracts/<name>.json`.
- `--format mjs` (default) emits the runtime stub, `--format dts` the
  declaration file.
- Without `--out` the stub goes to stdout; with `--out` it is written there,
  creating directories as needed.
- `--check` writes nothing and exits non-zero if the file at `--out` differs
  from what the contract generates, printing the command that regenerates it.

Stubs are build artifacts that are **committed**, so a parent builds on a clean
checkout with no generation step. `--check` in an acceptance gate is what keeps
a committed stub honest; this repository's own gate does that for
`examples/typed-stub/stubs/`.

Convention: a project's stubs live in one `stubs/` directory, one file per
contract, named after the contract.

## Stub semantics

A generated `.mjs` stub guarantees exactly three things:

1. **The module graph resolves.** Every symbol the block declares is exported,
   so importing the stub — and importing a parent that imports it — succeeds.
2. **Nothing passes through it.** Calling any symbol throws
   `not implemented: <contract>/<symbol>`, which names the contract that is
   still Open and the symbol that was reached. A stub can therefore never make
   an acceptance gate pass; a green gate over a stub would be the one way this
   protocol could lie.
3. **The stub is self-identifying.** It exports
   `__stub = { contract, env, symbols }`, so tooling and a reader can tell a
   stub from an implementation without guessing from the file path.

The runtime stub declares no parameters. Arity and types are the compiler's
job, checked against the `.d.mts` generated from the same block.

## Env pinning

A contract's `env` is the toolchain under which its acceptance is meaningful,
so it is also the toolchain under which its stub is meaningful. The pin travels
into the generated stub twice:

- recorded as `__stub.env`, verbatim, for every `env` value;
- enforced at load time when the pin has the form `node>=<version>`: the stub
  throws `stub <contract>: env pin "<env>" is not satisfied by node <running>`
  before any import of it can succeed.

Generation itself is never gated on the running toolchain — a stub for
`node>=22` can be generated on node 20, and a stub for a non-node toolchain
(`rustc>=1.80`) carries its pin as metadata for that toolchain's own gate to
enforce. What must not happen is a parent silently building against a stub
whose environment it is not entitled to.

## Worked example: TypeScript

`examples/typed-stub/` is a parent decomposed into one child that does not
exist:

| file | role |
|---|---|
| `contracts/greet.json` | the child contract, with a stub block in its `interface` |
| `stubs/greet.mjs` | generated runtime stub (`--format mjs`) |
| `stubs/greet.d.mts` | generated declarations (`--format dts`) |
| `src/banner.mjs` | the parent, importing `../stubs/greet.mjs` |
| `ts/banner.mts` | the same parent in TypeScript, importing the same specifier |
| `tsconfig.json` | `module: nodenext`, `strict`, `noEmit` |

The two parents import the identical specifier `../stubs/greet.mjs`. Node
resolves it to the runtime stub; under `moduleResolution: nodenext` TypeScript
resolves it to `greet.d.mts` beside it. One contract, one generator, both
gates — the compiler checks `banner`'s call sites, and node loads its module
graph, while `greet` has no implementation anywhere.

```sh
node -e "import('./examples/typed-stub/src/banner.mjs').then((m) => m.banner('Ada'))"
# Error: not implemented: greet/shout

npx tsc -p examples/typed-stub   # type-checks the parent against the stub
```

The acceptance gate never runs `tsc`: law L1 keeps this repository at zero
runtime dependencies. What the gate checks instead is that the committed
`.d.mts` is byte-for-byte what the contract generates, which is the property a
`tsc` run would depend on anyway. A project whose own `env` pins a TypeScript
toolchain puts `tsc --noEmit` in its parent contract's `acceptance` instead.

## Lifecycle

1. Publish each child contract with a stub block in its `interface`.
2. Generate the stubs, commit them, and write the parent against them.
3. Submit the parent's `decomposition` — `SKETCH_ACCEPTED`, children Open.
4. A child is implemented: its module replaces the stub file at the same
   specifier, and `stubs/<child>.mjs` is deleted in that submission. Nothing in
   the parent changes — that is the whole point of building against the
   contract rather than against an implementation.
5. `node tools/verify.mjs` runs the parent's integration gate by cascade. Any
   call site still reaching a stub fails it with the contract's own name.

Because a stub cannot pass a gate, a stub left behind after its child landed is
not a silent hazard: it is a `not implemented:` error naming the contract that
was supposed to replace it.
