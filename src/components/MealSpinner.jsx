import { useState, useEffect, useRef, useCallback, useMemo } from 'react';

/**
 * MealSpinner — Slot-machine meal randomizer.
 *
 * Props:
 *   meals              - All meals
 *   rotationMeals      - Rotation meals (preferred pool if ≥5)
 *   currentPlan        - Current week plan array[7], used to preserve locked meals
 *   onComplete(meals)  - Called with meals[numSlots] — one pick per active slot
 *   onClose            - Dismiss without applying
 *   selectedDayIndices - Optional int[] of DOW indices (0=Mon…6=Sun).
 *                        Null/empty → spin all 7.
 *   slotDates          - Optional Date[] parallel to activeDayIndices, shown as date labels
 */

const DAY_LABELS  = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function fmtDate(d) {
  if (!d) return '';
  return `${MONTH_SHORT[d.getMonth()]} ${d.getDate()}`;
}

// ── Animations CSS (injected once) ───────────────────────────────────────────
const SPIN_CSS = `
  @keyframes sp-slotIn   { from{opacity:0;transform:translateY(10px) scale(.94)} to{opacity:1;transform:none} }
  @keyframes sp-resolveP { 0%{transform:scale(.85);opacity:.4} 60%{transform:scale(1.06)} 100%{transform:scale(1);opacity:1} }
  @keyframes sp-shimmer  { 0%{background-position:-200% 0} 100%{background-position:200% 0} }
  @keyframes sp-glow     { 0%,100%{box-shadow:0 0 0 0 rgba(230,81,0,0)} 50%{box-shadow:0 0 0 8px rgba(230,81,0,.22)} }
  @keyframes sp-bounce   { 0%,100%{transform:translateY(0)} 40%{transform:translateY(-5px)} 70%{transform:translateY(2px)} }
  @keyframes sp-confetti { 0%{transform:translateY(-20px) rotate(0deg);opacity:1} 100%{transform:translateY(70px) rotate(380deg);opacity:0} }
  @keyframes sp-fadeIn   { from{opacity:0} to{opacity:1} }
`;

const CONFETTI_COLORS = ['#e65100','#ff833a','#2e7d32','#1565c0','#7b1fa2','#f59e0b','#e91e63'];

function Confetti() {
  return (
    <div style={{position:'absolute',top:0,left:0,right:0,height:100,overflow:'hidden',pointerEvents:'none',zIndex:20}}>
      {Array.from({length:20},(_,i)=>(
        <div key={i} style={{
          position:'absolute', top:0,
          left:`${5+(i*11)%90}%`,
          width: i%3===0?8:6, height: i%3===0?8:6,
          borderRadius: i%2===0?'50%':3,
          background: CONFETTI_COLORS[i%CONFETTI_COLORS.length],
          animation:`sp-confetti ${.7+(i*.11)%0.5}s ease-out ${(i*.07)%0.35}s forwards`,
        }}/>
      ))}
    </div>
  );
}

function Dots() {
  return (
    <div style={{display:'flex',gap:6}}>
      {[0,1,2].map(i=>(
        <div key={i} style={{
          width:9,height:9,borderRadius:'50%',background:'var(--primary)',
          animation:`sp-bounce .7s ${i*.13}s ease infinite`,
        }}/>
      ))}
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function MealSpinner({
  meals,
  rotationMeals,
  currentPlan,
  onComplete,
  onClose,
  selectedDayIndices,
  slotDates,
}) {
  // Inject CSS once
  useEffect(()=>{
    if(document.getElementById('sp-css')) return;
    const s=document.createElement('style'); s.id='sp-css'; s.textContent=SPIN_CSS;
    document.head.appendChild(s);
  },[]);

  const activeDayIndices = useMemo(()=>
    (selectedDayIndices && selectedDayIndices.length>0) ? selectedDayIndices : [0,1,2,3,4,5,6],
  [selectedDayIndices]);

  const numSlots = activeDayIndices.length;

  const [phase, setPhase]         = useState('ready');
  const [slots, setSlots]         = useState(()=>Array(numSlots).fill(null));
  const [display, setDisplay]     = useState(()=>Array(numSlots).fill(''));
  const [resolved, setResolved]   = useState(()=>Array(numSlots).fill(false));
  const [pickedMeals, setPickedMeals] = useState(null); // meals[numSlots]
  const timers = useRef([]);

  const pool = (rotationMeals && rotationMeals.length>=5) ? rotationMeals : meals;
  const usingRotation = !!(rotationMeals && rotationMeals.length>=5);
  const minNeeded = Math.max(1, Math.min(5, numSlots));

  // Build picks array[numSlots] — preserves locked meals from currentPlan
  const buildPicks = useCallback(()=>{
    const shuffled = [...pool].sort(()=>Math.random()-.5);
    const picks = [];
    let pi = 0;
    activeDayIndices.forEach(dayIdx=>{
      if(dayIdx<7 && currentPlan?.[dayIdx]?._locked) {
        picks.push(currentPlan[dayIdx]);
      } else {
        picks.push(shuffled[pi%shuffled.length]);
        pi++;
      }
    });
    return picks;
  },[pool,currentPlan,activeDayIndices]);

  const startSpin = useCallback(()=>{
    if(pool.length<minNeeded) return;
    setPhase('spinning');
    setResolved(Array(numSlots).fill(false));
    const picks = buildPicks();
    setPickedMeals(picks);
    const names = pool.map(m=>m.name);

    timers.current.forEach(clearInterval);
    timers.current=[];

    for(let si=0;si<numSlots;si++){
      const dayIdx = activeDayIndices[si];
      let tick=0;
      const speed = 55+si*10;
      const stopAt = 18+si*9;
      const iv = setInterval(()=>{
        tick++;
        if(tick>=stopAt){
          clearInterval(iv);
          setDisplay(p=>{const n=[...p];n[si]=picks[si]?.name||'';return n;});
          setSlots(p=>{const n=[...p];n[si]=picks[si];return n;});
          setResolved(p=>{const n=[...p];n[si]=true;return n;});
          if(si===numSlots-1) setTimeout(()=>setPhase('done'),500);
        } else {
          const r=names[Math.floor(Math.random()*names.length)];
          setDisplay(p=>{const n=[...p];n[si]=r;return n;});
        }
      },speed);
      timers.current.push(iv);
    }
  },[pool,buildPicks,numSlots,activeDayIndices,minNeeded]);

  // Reset when numSlots changes
  useEffect(()=>{
    setPhase('ready');
    setSlots(Array(numSlots).fill(null));
    setDisplay(Array(numSlots).fill(''));
    setResolved(Array(numSlots).fill(false));
    setPickedMeals(null);
    timers.current.forEach(clearInterval);
    timers.current=[];
  },[numSlots]);

  useEffect(()=>()=>timers.current.forEach(clearInterval),[]);

  const handleAccept = ()=>{
    if(pickedMeals) onComplete(pickedMeals);
  };
  const handleAgain = ()=>{
    setPhase('ready');
    setSlots(Array(numSlots).fill(null));
    setDisplay(Array(numSlots).fill(''));
    setResolved(Array(numSlots).fill(false));
    setPickedMeals(null);
  };

  const slotW = numSlots<=3?90:numSlots<=5?72:54;

  return (
    <div
      onClick={e=>e.stopPropagation()}
      style={{
        background:'var(--card)', borderRadius:24,
        boxShadow:'0 24px 64px rgba(0,0,0,.3)',
        width:'100%', maxWidth:560, maxHeight:'88vh',
        overflowY:'auto', overflowX:'hidden',
        display:'flex', flexDirection:'column',
        animation:'sp-slotIn .3s cubic-bezier(.32,.72,0,1) both',
        position:'relative',
      }}
    >
      {phase==='done' && <Confetti/>}

      {/* Header */}
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'20px 20px 0'}}>
        <div>
          <h2 style={{margin:0,fontSize:22,fontWeight:900,color:'var(--text)',
            animation:phase==='done'?'sp-bounce .5s ease both':undefined}}>
            {phase==='ready'   && (numSlots===7?'🎰 Meal Spinner':`🎰 Spin ${numSlots} Day${numSlots!==1?'s':''}`)}
            {phase==='spinning'&& '⚡ Spinning…'}
            {phase==='done'    && (numSlots===7?'🎉 Your Week!':'🎉 Your Picks!')}
          </h2>
          {phase==='ready' && (
            <p style={{margin:'3px 0 0',fontSize:12,color:'var(--text-muted)'}}>
              {numSlots<7
                ? `${numSlots} day${numSlots!==1?'s':''} · tap dates to see schedule`
                : 'Full week · locked meals preserved'}
            </p>
          )}
        </div>
        {phase!=='spinning' && (
          <button onClick={onClose} style={{
            width:34,height:34,borderRadius:'50%',border:'none',
            background:'var(--surface)',color:'var(--text-light)',
            fontSize:17,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',
          }}>✕</button>
        )}
      </div>

      {/* Source badge */}
      <div style={{padding:'10px 20px 0'}}>
        {usingRotation
          ? <span style={BADGE_ROT}>🔄 The Rotation · {rotationMeals.length} meals</span>
          : <span style={BADGE_ALL}>
              {rotationMeals?.length>0&&rotationMeals.length<5
                ? `⚠️ Need 5+ in Rotation (have ${rotationMeals.length})`
                : '📚 All meals'}
            </span>
        }
      </div>

      {/* Slot grid */}
      <div style={{
        display:'grid',
        gridTemplateColumns:`repeat(${numSlots},minmax(${slotW}px,1fr))`,
        gap:6, padding:'16px 16px 8px',
        overflowX: numSlots>6?'auto':undefined,
      }}>
        {activeDayIndices.map((dayIdx,si)=>{
          const isRes = resolved[si];
          const isSpin = phase==='spinning' && !isRes;
          const meal = slots[si];
          const date = slotDates?.[si];

          return (
            <div key={`${dayIdx}-${si}`} style={{
              display:'flex',flexDirection:'column',alignItems:'center',
              background: isRes
                ? 'linear-gradient(160deg,rgba(230,81,0,.07),rgba(255,131,58,.04))'
                : 'var(--surface)',
              border: isRes?'1.5px solid rgba(230,81,0,.25)':'1.5px solid var(--border)',
              borderRadius:14, padding:'10px 6px',
              minWidth:slotW,
              transition:'all .3s ease',
              animation:`sp-slotIn .35s ${si*.04}s both ease`,
              boxShadow: isRes?'0 4px 16px rgba(230,81,0,.1)':undefined,
            }}>
              {/* Day label */}
              <span style={{fontSize:11,fontWeight:800,letterSpacing:'.5px',
                color:'var(--primary)',textTransform:'uppercase',marginBottom:2}}>
                {DAY_LABELS[dayIdx]}
              </span>
              {/* Date label */}
              {date && (
                <span style={{fontSize:10,color:'var(--text-muted)',fontWeight:600,marginBottom:6}}>
                  {fmtDate(date)}
                </span>
              )}
              {/* Reel */}
              <div style={{
                width:'100%',minHeight:52,
                background: isSpin
                  ? 'linear-gradient(90deg,var(--surface) 25%,var(--border) 50%,var(--surface) 75%)'
                  : 'transparent',
                backgroundSize: isSpin?'200% 100%':undefined,
                animation: isSpin?'sp-shimmer 1s linear infinite':undefined,
                borderRadius:8,border:isSpin?'1px solid var(--border)':undefined,
                display:'flex',alignItems:'center',justifyContent:'center',
                padding:'4px 2px',transition:'all .25s ease',
              }}>
                {phase==='ready'
                  ? <span style={{fontSize:22,opacity:.3}}>?</span>
                  : <span style={{
                      fontSize:numSlots<=3?12:10,fontWeight:700,
                      color:isRes?'var(--text)':'var(--text-muted)',
                      textAlign:'center',lineHeight:1.3,
                      display:'-webkit-box',WebkitLineClamp:3,
                      WebkitBoxOrient:'vertical',overflow:'hidden',
                      animation:isRes?'sp-resolveP .35s cubic-bezier(.34,1.56,.64,1) both':undefined,
                      padding:'0 2px',
                    }}>
                      {display[si]||'…'}
                    </span>
                }
              </div>
              {/* Meal image when resolved */}
              {isRes && meal?.imageUrl && (
                <div style={{width:'100%',marginTop:6,borderRadius:8,overflow:'hidden'}}>
                  <img src={meal.imageUrl} alt=""
                    style={{width:'100%',height:numSlots<=4?56:36,objectFit:'cover',display:'block',
                      animation:'sp-resolveP .4s .1s ease both'}}
                    onError={e=>e.target.style.display='none'}
                  />
                </div>
              )}
              {/* Checkmark */}
              {isRes && (
                <div style={{
                  marginTop:6,width:18,height:18,borderRadius:'50%',
                  background:'var(--primary)',display:'flex',alignItems:'center',justifyContent:'center',
                  animation:'sp-resolveP .3s cubic-bezier(.34,1.56,.64,1) both',
                }}>
                  <span style={{color:'white',fontSize:11,fontWeight:900}}>✓</span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Actions */}
      <div style={{padding:'8px 20px 24px',display:'flex',flexDirection:'column',gap:10}}>
        {phase==='ready' && (
          <button onClick={startSpin} disabled={pool.length<minNeeded} style={{
            padding:15,borderRadius:14,border:'none',
            background: pool.length<minNeeded
              ? 'var(--border)'
              : 'linear-gradient(135deg,var(--primary),var(--primary-light))',
            color: pool.length<minNeeded?'var(--text-muted)':'white',
            fontSize:16,fontWeight:800,
            cursor:pool.length<minNeeded?'not-allowed':'pointer',
            boxShadow:pool.length>=minNeeded?'0 4px 20px rgba(230,81,0,.35)':undefined,
            animation:pool.length>=minNeeded?'sp-glow 2.5s ease infinite':undefined,
          }}>
            {pool.length<minNeeded
              ? `Need ${minNeeded-pool.length} more meal${minNeeded-pool.length!==1?'s':''}`
              : "🎲 Let's Spin!"}
          </button>
        )}
        {phase==='spinning' && (
          <div style={{display:'flex',alignItems:'center',justifyContent:'center',gap:12,padding:'8px 0'}}>
            <Dots/>
            <span style={{fontSize:14,color:'var(--text-light)',fontWeight:600}}>Picking your meals…</span>
          </div>
        )}
        {phase==='done' && (
          <div style={{display:'flex',gap:10,animation:'sp-fadeIn .3s .1s ease both'}}>
            <button onClick={handleAccept} style={{
              flex:2,padding:15,borderRadius:14,border:'none',
              background:'linear-gradient(135deg,var(--primary),var(--primary-light))',
              color:'white',fontSize:15,fontWeight:800,cursor:'pointer',
              boxShadow:'0 4px 20px rgba(230,81,0,.35)',
            }}>✓ Keep These</button>
            <button onClick={handleAgain} style={{
              flex:1,padding:15,borderRadius:14,
              border:'1.5px solid var(--border)',background:'var(--surface)',
              color:'var(--text)',fontSize:14,fontWeight:700,cursor:'pointer',
            }}>🔄 Again</button>
          </div>
        )}
      </div>
    </div>
  );
}

const BADGE_ROT = {
  display:'inline-block',padding:'4px 10px',borderRadius:20,
  background:'rgba(46,125,50,.1)',color:'#2e7d32',
  fontSize:11,fontWeight:700,border:'1px solid rgba(46,125,50,.2)',
};
const BADGE_ALL = {
  display:'inline-block',padding:'4px 10px',borderRadius:20,
  background:'var(--surface)',color:'var(--text-muted)',
  fontSize:11,fontWeight:600,border:'1px solid var(--border)',
};
