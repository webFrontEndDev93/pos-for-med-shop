import { useEffect, useMemo, useRef, useState, forwardRef, useImperativeHandle } from 'react';
import { batchesFor, stockFor, useStore } from '../lib/store';
import { expiryLabel, fuzzyScore, money, todayISO } from '../lib/format';
import type { Batch, Product } from '../lib/types';
import { Icon } from './Icon';
import { Badge } from './ui';

export interface SearchHandle {
  focus: () => void;
}

interface Hit {
  product: Product;
  batch: Batch | null;
  stock: number;
  score: number;
}

interface ProductSearchProps {
  onPick: (product: Product, batch: Batch) => void;
  cartCount: number;
}

/**
 * The till's main input. Everything is reachable without the mouse: type to
 * filter, ↑/↓ to move, Enter to add the nearest-expiry batch, Esc to clear.
 */
export const ProductSearch = forwardRef<SearchHandle, ProductSearchProps>(function ProductSearch(
  { onPick, cartCount }, ref,
) {
  const { products, batches } = useStore();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const today = todayISO();

  useImperativeHandle(ref, () => ({
    focus: () => {
      inputRef.current?.focus();
      inputRef.current?.select();
    },
  }), []);

  const hits = useMemo<Hit[]>(() => {
    const needle = query.trim();
    const scored: Hit[] = [];

    for (const product of products) {
      // Match against everything the counter staff might type, including the
      // barcode so a scanner gun works with no extra wiring.
      const haystacks = [product.name, product.genericName, product.barcode, product.manufacturer];
      let best = -1;
      for (const hay of haystacks) {
        if (!hay) continue;
        const score = fuzzyScore(hay, needle);
        if (score >= 0 && (best === -1 || score < best)) best = score;
      }
      if (best === -1) continue;

      const available = batchesFor(batches, product.id, today);
      scored.push({
        product,
        batch: available[0] ?? null,
        stock: stockFor(batches, product.id, today),
        score: best + (available.length === 0 ? 500 : 0),
      });
    }

    return scored.sort((a, b) => a.score - b.score || a.product.name.localeCompare(b.product.name)).slice(0, 40);
  }, [products, batches, query, today]);

  useEffect(() => setActive(0), [query]);

  // Keep the highlighted row inside the scroll viewport as you arrow through.
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const choose = (hit: Hit) => {
    if (!hit.batch) return;
    onPick(hit.product, hit.batch);
    setQuery('');
    setOpen(false);
    inputRef.current?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, hits.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const hit = hits[active];
      if (hit?.batch) choose(hit);
    } else if (event.key === 'Escape') {
      if (query) {
        setQuery('');
        setOpen(false);
      } else {
        inputRef.current?.blur();
      }
    }
  };

  const showResults = open && query.trim().length > 0;

  return (
    <div className="search-zone">
      <div className="search-box">
        <Icon name="search" size={18} className="search-icon" />
        <input
          ref={inputRef}
          className="search-input"
          placeholder="Search medicine by name, salt, brand or barcode…"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 140)}
          onKeyDown={onKeyDown}
          aria-label="Search medicines"
          autoComplete="off"
          spellCheck={false}
        />
        <div className="search-actions">
          {query ? (
            <button
              type="button"
              className="btn btn--ghost btn--sm btn--icon"
              onClick={() => { setQuery(''); inputRef.current?.focus(); }}
              aria-label="Clear search"
            >
              <Icon name="close" size={14} />
            </button>
          ) : (
            <>
              <kbd className="kbd">/</kbd>
              {cartCount > 0 && <Badge tone="brand">{cartCount} in bill</Badge>}
            </>
          )}
        </div>
      </div>

      {showResults && (
        <div className="results" ref={listRef} role="listbox" aria-label="Search results">
          {hits.length === 0 && (
            <div style={{ padding: 'var(--space-5)', textAlign: 'center' }} className="muted">
              <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text)' }}>
                No medicine matches “{query}”
              </div>
              <div style={{ fontSize: 'var(--text-xs)', marginTop: 4 }}>
                Add it from the Inventory screen first.
              </div>
            </div>
          )}

          {hits.map((hit, index) => {
            const out = !hit.batch;
            return (
              <button
                key={hit.product.id}
                type="button"
                role="option"
                aria-selected={index === active}
                className="result"
                data-active={index === active}
                disabled={out}
                onMouseEnter={() => setActive(index)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(hit)}
              >
                <div className="grow">
                  <div className="result-name">
                    <span className="truncate">{hit.product.name}</span>
                    {hit.product.strength && hit.product.strength !== '—' && (
                      <span className="muted" style={{ fontWeight: 500 }}>{hit.product.strength}</span>
                    )}
                    {hit.product.prescriptionRequired && <Badge tone="info">Rx</Badge>}
                  </div>
                  <div className="result-meta">
                    {hit.product.manufacturer} · {hit.product.packSize}
                    {hit.product.rack && ` · Rack ${hit.product.rack}`}
                    {hit.batch && ` · B:${hit.batch.batchNo} · ${expiryLabel(hit.batch.expiry)}`}
                  </div>
                </div>

                <div className="result-right">
                  {out ? (
                    <Badge tone="danger">Out of stock</Badge>
                  ) : (
                    <>
                      <span className="result-price">{money(hit.batch!.salePrice)}</span>
                      <Badge tone={hit.stock <= hit.product.reorderLevel ? 'warning' : 'neutral'}>
                        {hit.stock} left
                      </Badge>
                    </>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
});
