import { authFetch } from './authFetch';

/**
 * Tell the trail that data left the building.
 *
 * Every other audit record is written by the server handler that made the
 * change, and deliberately so. Exports and prints are the exception: the rows
 * are already in the browser, the spreadsheet is built there, and the printed
 * page never touches the server — so there is no request for a handler to
 * record. Without this call the one act that carries regulated data outside the
 * system is the only act with no trace, which is exactly backwards.
 *
 * The endpoint accepts three event names and nothing else, and still writes the
 * wording, module and severity from the vocabulary; this function can claim an
 * export happened, and nothing more than that.
 *
 * Deliberately fire-and-forget. A person pressing "خروجی اکسل" gets their file
 * whether or not the note about it was accepted; failing the download because
 * the audit call timed out would be a worse trade than a missing row.
 */
export type DataOutEvent = 'data.exported' | 'data.printed' | 'data.backup_downloaded';

export function reportDataOut(event: DataOutEvent, label: string, rows?: number): void {
  void authFetch('/api/audit/events', {
    method: 'POST',
    body: JSON.stringify({ event, label, rows }),
  }).catch(err => console.error('Reporting the export to the audit trail failed:', err));
}
