/**
 * Serialise the mutating requests that touch one record.
 *
 * Every write endpoint in this application is a read-modify-write: the handler
 * reads the row, merges the incoming fields and writes the whole thing back.
 * Two of those in flight at once — two operators, two tabs, or a retry arriving
 * beside the original — both read the same starting state, and the slower write
 * puts back its own stale copy of everything the faster one had just changed.
 *
 * This was written for the source endpoints, where it was measured: a contact
 * update racing a score update lost the contact change five times out of five,
 * silently, with both requests answering 200. Partners, materials and the
 * chosen-source decision have exactly the same shape and had no protection at
 * all, which is why the lock now lives here rather than inside the vendor
 * repository.
 *
 * Requests for the same record run one after another; requests for different
 * records, or for records in different modules, still run in parallel — hence
 * the scope, so a partner and a source that happen to share an id do not queue
 * behind each other.
 *
 * Scope worth knowing: this is an in-process lock, so it covers one Node
 * process — a single container, or PM2 in fork mode. Several instances behind a
 * load balancer each hold their own map, which is what the `updatedAt`
 * preconditions in the handlers are for.
 */
const chains = new Map<string, Promise<void>>();

export async function lockRecordWrite(scope: string, id: string): Promise<() => void> {
  const key = `${scope}:${id}`;
  const previous = chains.get(key) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>(resolve => {
    release = () => {
      // Only clear the map when nobody queued behind us, so a later waiter does
      // not find a deleted chain and start in parallel with the one after it.
      if (chains.get(key) === mine) chains.delete(key);
      resolve();
    };
  });
  chains.set(key, previous.then(() => mine));
  return previous.then(() => release);
}

/**
 * Express middleware: hold the record's lock until the response is done.
 *
 * A route with no `:id` — a create — passes straight through: there is no
 * record yet for anybody else to be writing.
 */
export function serializeWrites(scope: string) {
  return async function serialize(req: any, res: any, next: any) {
    const id = req.params?.id;
    if (!id) return next();

    const release = await lockRecordWrite(scope, id);
    let released = false;
    const done = () => {
      if (released) return;
      released = true;
      release();
    };
    // 'close' covers a client that disconnects mid-request, which 'finish' does
    // not — without it an aborted request would hold the lock for ever.
    res.once("finish", done);
    res.once("close", done);
    next();
  };
}

/**
 * The copy this caller edited is still the current one — or it is not.
 *
 * The per-request precondition inside a save only closes the window between a
 * handler's own read and its own write. It says nothing about the older and
 * more common case: somebody opened a form, went to a meeting, and saved an
 * hour later over three edits made in between. The handler re-reads the row,
 * merges the incoming fields into it and writes — so the stale form silently
 * wins for every field it carries.
 *
 * So the client sends back the `updatedAt` it read, and this compares it with
 * the row as it stands now. A mismatch is refused with 409 before any work is
 * done, and the client re-reads and tells the operator.
 *
 * Absent means "not claimed": an older client, a script, or a create keeps
 * exactly the behaviour it had. An unparseable value is treated the same way
 * rather than failing the request, because a broken clock must not make the
 * register unwritable.
 */
export function staleCopy(req: any, current: any): boolean {
  const claimed = req?.body?.expectedUpdatedAt;
  if (typeof claimed !== "string" || claimed === "") return false;
  const asked = new Date(claimed);
  if (Number.isNaN(asked.getTime())) return false;
  const actual = current?.updatedAt ? new Date(current.updatedAt) : null;
  if (!actual || Number.isNaN(actual.getTime())) return false;
  return asked.getTime() !== actual.getTime();
}

export const STALE_COPY_MESSAGE =
  "این رکورد هم‌زمان توسط شخص دیگری تغییر کرده است. نسخهٔ تازه بارگذاری شد؛ تغییر خود را دوباره اعمال کنید.";
