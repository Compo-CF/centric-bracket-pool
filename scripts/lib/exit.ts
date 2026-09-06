/**
 * Ending a script cleanly.
 *
 * Calling process.exit() while firebase-admin still has an open gRPC
 * connection trips a libuv assertion and aborts with exit code 127 -- which
 * reads as a crash to CI even when the work succeeded. Setting exitCode and
 * returning lets Node close its handles first.
 */

export class ScriptExit extends Error {
  constructor(readonly code: number, message?: string) {
    super(message ?? `exit ${code}`);
    this.name = 'ScriptExit';
  }
}

/** Wrap a script body so fail()/done() unwind without killing open handles. */
export async function run(main: () => Promise<void> | void): Promise<void> {
  try {
    await main();
  } catch (error) {
    if (error instanceof ScriptExit) {
      process.exitCode = error.code;
      return;
    }
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  }
}
