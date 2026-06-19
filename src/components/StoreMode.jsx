import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { Reorder, motion, AnimatePresence, useDragControls } from 'framer-motion';
import { X, Check, GripVertical, Eye, EyeOff } from 'lucide-react';
import { GROCERY_CATEGORIES, categorizeIngredient } from '../recipeSchema';
import { hapticLight, hapticSuccess } from '../haptics';
import './StoreMode.css';

// A-3 Store Mode — a focused, in-store shopping state. Big one-thumb targets,
// department grouping in YOUR aisle order (drag to reorder, persisted), checked
// items sink with a strikethrough, a progress ring, and a screen wake lock so
// the phone stays awake while you push the cart. 100% offline.

const PANTRY_ID = '__pantry__';
const DEPT_ORDER_KEY = 'spicehub_dept_order';

const DEPT_EMOJI = {
  'Produce': '🥦',
  'Meat & Seafood': '🥩',
  'Dairy': '🥛',
  'Pantry': '🫙',
  'Frozen': '🧊',
  'Bakery': '🍞',
  'Other': '🛒',
};

function loadDeptOrder() {
  try {
    const raw = localStorage.getItem(DEPT_ORDER_KEY);
    const arr = raw ? JSON.parse(raw) : null;
    return Array.isArray(arr) ? arr.filter(d => typeof d === 'string') : [];
  } catch { return []; }
}
function saveDeptOrder(order) {
  try { localStorage.setItem(DEPT_ORDER_KEY, JSON.stringify(order)); } catch { /* ignore */ }
}

const norm = (s) => (s || '').toString().trim().toLowerCase();

// ── Progress ring (inline SVG) ───────────────────────────────────────────────
function ProgressRing({ done, total }) {
  const pct = total > 0 ? done / total : 0;
  const R = 16;
  const C = 2 * Math.PI * R;
  return (
    <div className="sm-ring" role="img" aria-label={`${done} of ${total} items checked`}>
      <svg width="40" height="40" viewBox="0 0 40 40">
        <circle cx="20" cy="20" r={R} className="sm-ring-track" />
        <circle
          cx="20" cy="20" r={R}
          className="sm-ring-fill"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - pct)}
          transform="rotate(-90 20 20)"
        />
      </svg>
      <span className="sm-ring-label">{done}<span className="sm-ring-of">/{total}</span></span>
    </div>
  );
}

// ── A single shopping line (aggregated across duplicate ingredient rows) ─────
function StoreLine({ line, onToggle }) {
  return (
    <motion.button
      type="button"
      layout
      className={`sm-line${line.checked ? ' sm-line-checked' : ''}`}
      onClick={() => onToggle(line)}
      whileTap={{ scale: 0.98 }}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 420, damping: 32 }}
    >
      <span className={`sm-check${line.checked ? ' sm-check-on' : ''}`} aria-hidden="true">
        {line.checked && <Check size={22} strokeWidth={3} />}
      </span>
      <span className="sm-line-text">
        {line.qty && <span className="sm-line-qty">{line.qty} </span>}
        {line.name}
      </span>
    </motion.button>
  );
}

// ── One department: draggable ONLY by its header grip, so vertical scrolling
//    over the item rows never gets captured as a reorder. ──
function DeptSection({ dept, group, hideChecked, onToggle }) {
  const controls = useDragControls();
  const shownLines = hideChecked ? group.lines.filter(l => !l.checked) : group.lines;
  return (
    <Reorder.Item
      value={dept}
      as="section"
      className="sm-dept"
      dragListener={false}
      dragControls={controls}
      whileDrag={{ scale: 1.02, boxShadow: '0 10px 30px rgba(0,0,0,0.18)' }}
    >
      <div
        className="sm-dept-head"
        onPointerDown={(e) => controls.start(e)}
        style={{ touchAction: 'none' }}
      >
        <GripVertical size={18} className="sm-dept-grip" aria-hidden="true" />
        <span className="sm-dept-emoji" aria-hidden="true">{DEPT_EMOJI[dept] || '🛒'}</span>
        <span className="sm-dept-name">{dept}</span>
        <span className="sm-dept-count">{group.done}/{group.total}</span>
      </div>
      <AnimatePresence initial={false}>
        {shownLines.length === 0 ? (
          <motion.p
            key="empty"
            className="sm-dept-empty"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          >
            {hideChecked ? 'All checked off' : 'No items'}
          </motion.p>
        ) : (
          shownLines.map(line => (
            <StoreLine key={norm(line.name)} line={line} onToggle={onToggle} />
          ))
        )}
      </AnimatePresence>
    </Reorder.Item>
  );
}

export default function StoreMode({ items, setItems, onExit, onToast }) {
  const [hideChecked, setHideChecked] = useState(false);
  const [deptOrder, setDeptOrder] = useState(() => loadDeptOrder());
  const wakeRef = useRef(null);

  // ── Wake lock: keep the screen on while shopping ──────────────────────────
  useEffect(() => {
    let released = false;
    const acquire = async () => {
      try {
        if ('wakeLock' in navigator && navigator.wakeLock?.request) {
          wakeRef.current = await navigator.wakeLock.request('screen');
        }
      } catch { /* unsupported or denied — fine */ }
    };
    acquire();
    const onVis = () => {
      if (document.visibilityState === 'visible' && !released) acquire();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      released = true;
      document.removeEventListener('visibilitychange', onVis);
      try { wakeRef.current?.release?.(); } catch { /* ignore */ }
      wakeRef.current = null;
    };
  }, []);

  // ── Group items by department, aggregating duplicate names ────────────────
  const { groups, totalCount, doneCount } = useMemo(() => {
    const byDept = new Map(); // dept -> Map(normName -> line)
    let total = 0;
    let done = 0;

    items.forEach((item, idx) => {
      if (!item || item.store === PANTRY_ID) return; // pantry items aren't shopped
      const dept = item.category || categorizeIngredient(item.name) || 'Other';
      const key = norm(item.name);
      if (!byDept.has(dept)) byDept.set(dept, new Map());
      const lines = byDept.get(dept);
      if (!lines.has(key)) {
        lines.set(key, { name: item.name, qty: item.qty || '', indices: [], checked: true });
      }
      const line = lines.get(key);
      line.indices.push(idx);
      line.checked = line.checked && !!item.checked; // checked only if ALL copies are
    });

    const result = [];
    byDept.forEach((lines, dept) => {
      const arr = Array.from(lines.values());
      const deptTotal = arr.length;
      const deptDone = arr.filter(l => l.checked).length;
      total += deptTotal;
      done += deptDone;
      // Unchecked first, checked sink to the bottom, alphabetical within each.
      arr.sort((a, b) => (a.checked === b.checked
        ? a.name.localeCompare(b.name)
        : (a.checked ? 1 : -1)));
      result.push({ dept, lines: arr, total: deptTotal, done: deptDone });
    });
    return { groups: result, totalCount: total, doneCount: done };
  }, [items]);

  // ── Order departments: persisted order first, then canonical for the rest ──
  const orderedGroups = useMemo(() => {
    const rank = (d) => {
      const si = deptOrder.indexOf(d);
      if (si >= 0) return si;
      const ci = GROCERY_CATEGORIES.indexOf(d);
      return (ci >= 0 ? ci : 999) + 1000; // unknown/canonical fall after saved ones
    };
    return [...groups].sort((a, b) => rank(a.dept) - rank(b.dept));
  }, [groups, deptOrder]);

  const visibleDepts = useMemo(() => orderedGroups.map(g => g.dept), [orderedGroups]);

  const handleReorder = useCallback((newOrder) => {
    hapticLight();
    setDeptOrder(newOrder);
    saveDeptOrder(newOrder);
  }, []);

  const toggleLine = useCallback((line) => {
    const next = !line.checked;
    if (next) hapticLight();
    setItems(prev => prev.map((it, i) =>
      line.indices.includes(i) ? { ...it, checked: next } : it
    ));
  }, [setItems]);

  // Celebrate when everything is checked off.
  const prevDone = useRef(doneCount);
  useEffect(() => {
    if (totalCount > 0 && doneCount === totalCount && prevDone.current < totalCount) {
      hapticSuccess();
      onToast?.('Cart complete — nice work! 🎉');
    }
    prevDone.current = doneCount;
  }, [doneCount, totalCount, onToast]);

  const groupByDept = useMemo(() => {
    const m = new Map();
    orderedGroups.forEach(g => m.set(g.dept, g));
    return m;
  }, [orderedGroups]);

  return (
    <motion.div
      className="sm-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      {/* Header */}
      <div className="sm-header">
        <button className="sm-exit" onClick={onExit} aria-label="Exit store mode">
          <X size={20} /> <span>Done</span>
        </button>
        <ProgressRing done={doneCount} total={totalCount} />
        <button
          className={`sm-hide-toggle${hideChecked ? ' active' : ''}`}
          onClick={() => { hapticLight(); setHideChecked(h => !h); }}
          aria-pressed={hideChecked}
        >
          {hideChecked ? <EyeOff size={18} /> : <Eye size={18} />}
          <span>{hideChecked ? 'Show' : 'Hide'} done</span>
        </button>
      </div>

      <p className="sm-reorder-hint">Drag a department header to match your store's aisle order.</p>

      {/* Departments — drag to reorder, persisted per device */}
      <Reorder.Group
        as="div"
        axis="y"
        values={visibleDepts}
        onReorder={handleReorder}
        className="sm-list"
      >
        {visibleDepts.map(dept => {
          const group = groupByDept.get(dept);
          if (!group) return null;
          return (
            <DeptSection
              key={dept}
              dept={dept}
              group={group}
              hideChecked={hideChecked}
              onToggle={toggleLine}
            />
          );
        })}
      </Reorder.Group>

      {totalCount === 0 && (
        <div className="sm-alldone">
          <Check size={40} strokeWidth={2.5} />
          <p>Nothing left to shop.</p>
        </div>
      )}
    </motion.div>
  );
}
