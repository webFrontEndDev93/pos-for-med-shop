import { batchesFor, useStore } from '../lib/store';
import { expiryLabel, formatDate, money, todayISO } from '../lib/format';
import type { Batch, Product } from '../lib/types';
import { Badge, Modal, EmptyState } from './ui';

/** Lets the counter override the default FEFO batch — e.g. the customer wants a longer-dated pack. */
export function BatchPicker({
  product, currentBatchId, onPick, onClose,
}: {
  product: Product;
  currentBatchId: string;
  onPick: (batch: Batch) => void;
  onClose: () => void;
}) {
  const { batches } = useStore();
  const today = todayISO();
  const options = batchesFor(batches, product.id, today);

  return (
    <Modal
      title={`Choose batch — ${product.name}`}
      subtitle="Nearest expiry is listed first so older stock clears before it lapses."
      width="36rem"
      onClose={onClose}
    >
      {options.length === 0 ? (
        <EmptyState
          icon="alert"
          title="No sellable batch left"
          text="Every batch of this medicine is either finished or past its expiry date."
        />
      ) : (
        <div className="table-wrap" style={{ border: '1px solid var(--border)' }}>
          <table className="data">
            <thead>
              <tr>
                <th>Batch</th>
                <th>Expiry</th>
                <th className="right">MRP</th>
                <th className="right">Sale price</th>
                <th className="right">Stock</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {options.map((batch) => {
                const days = Math.round(
                  (new Date(`${batch.expiry}T00:00:00`).getTime() - new Date(`${today}T00:00:00`).getTime()) / 86_400_000,
                );
                const current = batch.id === currentBatchId;
                return (
                  <tr key={batch.id}>
                    <td className="mono">{batch.batchNo}</td>
                    <td>
                      <div>{formatDate(batch.expiry)}</div>
                      <div className="cell-sub">
                        <Badge tone={days <= 30 ? 'danger' : days <= 90 ? 'warning' : 'success'}>
                          {expiryLabel(batch.expiry)}
                        </Badge>
                      </div>
                    </td>
                    <td className="right num">{money(batch.mrp)}</td>
                    <td className="right num" style={{ fontWeight: 600 }}>{money(batch.salePrice)}</td>
                    <td className="right num">{batch.quantity}</td>
                    <td className="right">
                      <button
                        type="button"
                        className={`btn btn--sm ${current ? 'btn--ghost' : 'btn--primary'}`}
                        disabled={current}
                        onClick={() => { onPick(batch); onClose(); }}
                      >
                        {current ? 'In bill' : 'Use'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
