import { Loading, Placeholder } from './ui';

/** The history table's frame, with a few rows waiting for their weeks. */
export function HistoryLoading({ label, columns }: { label: string; columns: string[] }) {
  return (
    <Loading label={label}>
      <div className="history-table-scroll">
        <table className="history-table">
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column}>{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[0, 1, 2, 3].map((row) => (
              <tr key={row}>
                <th>
                  <Placeholder width="8.5em" />
                </th>
                {columns.slice(1).map((column) => (
                  <td key={column}>
                    <Placeholder width="2.2em" />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Loading>
  );
}
