import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  ArrowDownToLine, ArrowLeft, ArrowRight, ArrowUpRight, BookOpen, Check,
  ChevronDown, ChevronRight, CircleHelp, Clock3, Code2, Copy, ExternalLink,
  FileText, Focus, GitBranch, Hand, Layers3, Link2, Loader2, LogOut, MoreHorizontal, Move,
  Github, Highlighter, Network, Pencil, Plus, RefreshCw, Search, Settings2, Sparkles, Sprout, Tags,
  Terminal, Trash2, X, ZoomIn, ZoomOut,
} from 'lucide-react';
import './style.css';
import {usePanelWidths,ResizeHandle} from './PanelResize.jsx';
import GithubLogin,{authRequest} from './GithubLogin.jsx';
import Markdown,{MarkdownEditor} from './Markdown.jsx';
import AgentChat from './AgentChat.jsx';
import KnowledgeSearch from './KnowledgeSearch.jsx';
import {collectTerms,conceptSearchText} from '../shared/knowledge-search.mjs';
import {hierarchyRoots} from '../shared/graph-hierarchy.mjs';
import {normalizeName} from '../shared/graph-plan.mjs';

const API = '/api/v1';
const COLORS = ['#3d7b6a', '#6c87a8', '#b39560', '#9a80ad', '#ac7d72', '#77977b'];
const DEFAULT_CATEGORIES = ['DB', '시스템 설계', '서버 · 백엔드', '프론트엔드', 'AI · 에이전트'];
const RELATION_TYPES = [
  ['parent_of', '상위 → 하위'], ['related', '관련 개념'], ['part_of', '하위 개념'], ['alternative', '비교 대상'], ['evolves_into', '발전 관계'],
];

async function request(path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  let body;
  try { body = await response.json(); } catch { body = null; }
  if (!response.ok) {
    const error = new Error(body?.error?.message || body?.message || `요청을 처리하지 못했습니다 (${response.status}).`);
    error.status = response.status;
    error.code = body?.error?.code;
    throw error;
  }
  return body;
}

function dateLabel(value, includeTime = false) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '날짜 없음';
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric', month: 'short', day: 'numeric',
    ...(includeTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).format(date);
}

function relativeTime(value) {
  const diff = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(diff)) return '';
  if (diff < 60000) return '방금 전';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}분 전`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}시간 전`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}일 전`;
  return dateLabel(value);
}

function colorFor(category, categories) {
  const index = Math.max(0, categories.indexOf(category));
  return COLORS[index % COLORS.length];
}

function safeUrl(value) {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : null; } catch { return null; }
}

function selectedFromHash() {
  if (!window.location.hash.startsWith('#concept/')) return null;
  try { return decodeURIComponent(window.location.hash.slice(9)) || null; } catch { return null; }
}

async function copyText(value) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(value);
  const input = document.createElement('textarea');
  input.value = value; input.style.position = 'fixed'; input.style.opacity = '0';
  document.body.appendChild(input); input.select(); document.execCommand('copy'); input.remove();
}

function Field({ label, help, children, group = false }) {
  const Tag = group ? 'div' : 'label';
  const labelId=useId();
  const control=!group&&React.isValidElement(children)&&['input','textarea','select'].includes(children.type)?React.cloneElement(children,{'aria-labelledby':labelId}):children;
  return <Tag className="field"><span className="field-label" id={labelId}>{label}</span>{control}{help && <span className="field-help">{help}</span>}</Tag>;
}

function Modal({ title, subtitle, children, close, wide = false, footer }) {
  const ref = useRef(null);
  const closeRef = useRef(close); closeRef.current = close;
  useEffect(() => {
    const active = document.activeElement;
    ref.current?.querySelector('input, textarea, button')?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') closeRef.current();
      if (e.key === 'Tab') {
        const items = [...ref.current.querySelectorAll('button:not([disabled]), input, textarea, select, a[href]')].filter(el => el.offsetParent !== null);
        if (!items.length) return;
        if (e.shiftKey && document.activeElement === items[0]) { e.preventDefault(); items.at(-1).focus(); }
        else if (!e.shiftKey && document.activeElement === items.at(-1)) { e.preventDefault(); items[0].focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); active?.focus?.(); };
  }, []);
  return <div className="modal-backdrop" onMouseDown={e => e.target === e.currentTarget && close()}>
    <section ref={ref} role="dialog" aria-modal="true" aria-labelledby="modal-title" className={`modal ${wide ? 'wide' : ''}`}>
      <div className="modal-head"><div><h2 className="modal-title" id="modal-title">{title}</h2>{subtitle && <p className="muted-copy">{subtitle}</p>}</div><button className="icon-button" onClick={close} aria-label="닫기"><X size={19} /></button></div>
      <div className="modal-body">{children}</div>{footer && <div className="modal-footer">{footer}</div>}
    </section>
  </div>;
}

function Graph({ concepts, relations, hierarchyRelations=relations, selectedId, onSelect, onPositionChange, query, category, categories }) {
  const roots=useMemo(()=>hierarchyRoots(hierarchyRelations),[hierarchyRelations]);
  const svgRef = useRef(null);
  const gesture = useRef(null);
  const pointers = useRef(new Map());
  const viewRef = useRef({ x: 0, y: 0, scale: 1 });
  const layoutRef = useRef({});
  const [positions, setPositions] = useState({});
  const [view, setView] = useState(viewRef.current);
  const [placementMode, setPlacementMode] = useState(false);
  const [dragging, setDragging] = useState(false);
  const neighbors = useMemo(() => new Set(relations.flatMap(r => r.source_id === selectedId ? [r.target_id] : r.target_id === selectedId ? [r.source_id] : [])), [relations, selectedId]);
  const layout = useMemo(() => {
    const result = {};
    const supplied = concepts.some(c => Number.isFinite(c.x) && Number.isFinite(c.y) && (c.x !== 0 || c.y !== 0));
    concepts.forEach((c, index) => {
      const categoryIndex = Math.max(0, categories.indexOf(c.category));
      const siblings = concepts.filter(n => n.category === c.category);
      const siblingIndex = siblings.findIndex(n => n.id === c.id);
      const angle = (categoryIndex / Math.max(categories.length, 1)) * Math.PI * 2 - Math.PI / 2;
      const innerAngle = siblingIndex * 2.39996;
      const spread = siblingIndex === 0 ? 0 : 85 + Math.sqrt(siblingIndex) * 45;
      result[c.id] = positions[c.id] || (supplied && Number.isFinite(c.x) && Number.isFinite(c.y)
        ? { x: c.x, y: c.y }
        : { x: 550 + Math.cos(angle) * 230 + Math.cos(innerAngle) * spread, y: 400 + Math.sin(angle) * 200 + Math.sin(innerAngle) * spread });
    });
    return result;
  }, [concepts, positions, categories]);
  layoutRef.current = layout;
  const graphIdentity = concepts.map(c => c.id).join('|');
  const baseBox = useMemo(() => {
    const points = Object.values(layout);
    if (!points.length) return { x: 0, y: 0, width: 1100, height: 800 };
    const minX = Math.min(...points.map(p => p.x)) - 170;
    const minY = Math.min(...points.map(p => p.y)) - 140;
    const maxX = Math.max(...points.map(p => p.x)) + 170;
    const maxY = Math.max(...points.map(p => p.y)) + 140;
    return { x: minX, y: minY, width: Math.max(850, maxX - minX), height: Math.max(670, maxY - minY) };
  }, [graphIdentity, categories.join('|')]);

  const visibility = c => {
    if (!c) return false;
    const matchesQuery = !query || normalizeName(conceptSearchText(c)).includes(normalizeName(query));
    const matchesCategory = !category || c.category === category;
    return matchesQuery && matchesCategory;
  };
  const applyView = next => { viewRef.current = next; setView(next); };
  const clampScale = scale => Math.max(.2, Math.min(4, scale));
  const rootPoint = (clientX, clientY) => {
    const matrix = svgRef.current?.getScreenCTM();
    if (!matrix) return null;
    return new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse());
  };
  const zoomAt = (factor, anchor) => {
    const previous = viewRef.current;
    const scale = clampScale(previous.scale * factor);
    const ratio = scale / previous.scale;
    applyView({ x: anchor.x - (anchor.x - previous.x) * ratio, y: anchor.y - (anchor.y - previous.y) * ratio, scale });
  };
  const zoom = factor => {
    if (pointers.current.size) return;
    zoomAt(factor, { x: baseBox.x + baseBox.width / 2, y: baseBox.y + baseBox.height / 2 });
  };
  useEffect(() => {
    const svg = svgRef.current;
    const wheel = event => {
      event.preventDefault();
      if (pointers.current.size || !event.deltaY) return;
      const anchor = rootPoint(event.clientX, event.clientY);
      if (!anchor) return;
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? svg.clientHeight : 1;
      zoomAt(Math.exp(-Math.max(-600, Math.min(600, event.deltaY * unit)) * (event.ctrlKey ? .006 : .0018)), anchor);
    };
    svg.addEventListener('wheel', wheel, { passive: false });
    return () => svg.removeEventListener('wheel', wheel);
  }, []);
  const rollbackNode = g => {
    if (g?.kind === 'node' && g.moved) setPositions(previous => ({ ...previous, [g.nodeId]: g.startPosition }));
  };
  const singleGesture = (pointer, allowClick = true) => ({
    kind: allowClick && placementMode && pointer.nodeId ? 'node' : 'pan',
    nodeId: allowClick ? pointer.nodeId : null,
    startPoint: pointer.point, startClient: pointer.client,
    startView: { ...viewRef.current }, startPosition: pointer.nodeId ? layoutRef.current[pointer.nodeId] : null,
    moved: !allowClick, allowClick, lastPosition: null,
  });
  const startPinch = () => {
    const pair = [...pointers.current.values()].slice(0, 2);
    if (pair.length < 2) return;
    rollbackNode(gesture.current);
    const midpoint = { x: (pair[0].point.x + pair[1].point.x) / 2, y: (pair[0].point.y + pair[1].point.y) / 2 };
    const previous = viewRef.current;
    gesture.current = {
      kind: 'pinch',
      distance: Math.max(1, Math.hypot(pair[0].client.x - pair[1].client.x, pair[0].client.y - pair[1].client.y)),
      scale: previous.scale,
      anchor: { x: (midpoint.x - previous.x) / previous.scale, y: (midpoint.y - previous.y) / previous.scale },
    };
  };
  const begin = (event, nodeId = null) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const point = rootPoint(event.clientX, event.clientY);
    if (!point) return;
    event.preventDefault(); event.stopPropagation();
    const pointer = { point, client: { x: event.clientX, y: event.clientY }, nodeId };
    pointers.current.set(event.pointerId, pointer);
    try { svgRef.current.setPointerCapture(event.pointerId); } catch {}
    setDragging(true);
    if (pointers.current.size >= 2) startPinch();
    else gesture.current = singleGesture(pointer);
  };
  const move = event => {
    const pointer = pointers.current.get(event.pointerId);
    const g = gesture.current;
    if (!pointer || !g) return;
    const point = rootPoint(event.clientX, event.clientY);
    if (!point) return;
    event.preventDefault();
    pointer.point = point; pointer.client = { x: event.clientX, y: event.clientY };
    if (g.kind === 'pinch') {
      const pair = [...pointers.current.values()].slice(0, 2);
      if (pair.length < 2) return;
      const distance = Math.hypot(pair[0].client.x - pair[1].client.x, pair[0].client.y - pair[1].client.y);
      const scale = clampScale(g.scale * distance / g.distance);
      const midpoint = { x: (pair[0].point.x + pair[1].point.x) / 2, y: (pair[0].point.y + pair[1].point.y) / 2 };
      applyView({ x: midpoint.x - g.anchor.x * scale, y: midpoint.y - g.anchor.y * scale, scale });
      return;
    }
    if (Math.hypot(event.clientX - g.startClient.x, event.clientY - g.startClient.y) > 5) g.moved = true;
    if (!g.moved) return;
    const dx = point.x - g.startPoint.x, dy = point.y - g.startPoint.y;
    if (g.kind === 'node') {
      g.lastPosition = { x: g.startPosition.x + dx / g.startView.scale, y: g.startPosition.y + dy / g.startView.scale };
      setPositions(previous => ({ ...previous, [g.nodeId]: g.lastPosition }));
    } else applyView({ ...g.startView, x: g.startView.x + dx, y: g.startView.y + dy });
  };
  const end = (event, canceled = false) => {
    if (!pointers.current.has(event.pointerId)) return;
    const g = gesture.current;
    // Remove before releasing capture: lostpointercapture also reaches this handler.
    pointers.current.delete(event.pointerId);
    if (canceled) rollbackNode(g);
    else if (pointers.current.size === 0 && g && g.kind !== 'pinch') {
      if (g.kind === 'node' && g.moved && g.lastPosition) {
        const position = { x: Math.round(g.lastPosition.x), y: Math.round(g.lastPosition.y) };
        setPositions(previous => ({ ...previous, [g.nodeId]: position }));
        onPositionChange(g.nodeId, position);
      } else if (!g.moved && g.allowClick && g.nodeId) onSelect(g.nodeId===selectedId?null:g.nodeId);
    }
    if (pointers.current.size >= 2) startPinch();
    else if (pointers.current.size === 1) gesture.current = singleGesture([...pointers.current.values()][0], false);
    else { gesture.current = null; setDragging(false); }
    try { if (svgRef.current.hasPointerCapture(event.pointerId)) svgRef.current.releasePointerCapture(event.pointerId); } catch {}
  };
  const fit = () => {
    if (pointers.current.size) return;
    const points = Object.values(layoutRef.current);
    if (!points.length) return applyView({ x: 0, y: 0, scale: 1 });
    const minX = Math.min(...points.map(p => p.x)) - 170, maxX = Math.max(...points.map(p => p.x)) + 170;
    const minY = Math.min(...points.map(p => p.y)) - 100, maxY = Math.max(...points.map(p => p.y)) + 100;
    const scale = clampScale(Math.min(baseBox.width / (maxX - minX), baseBox.height / (maxY - minY)) * .9);
    applyView({ x: baseBox.x + baseBox.width / 2 - (minX + maxX) / 2 * scale, y: baseBox.y + baseBox.height / 2 - (minY + maxY) / 2 * scale, scale });
  };
  const visibleCount = concepts.filter(visibility).length;
  return <>
    <svg ref={svgRef} className={`graph-canvas ${placementMode ? 'placement-mode' : 'pan-mode'} ${dragging ? 'is-dragging' : ''}`} data-scale={view.scale} data-pan-x={view.x} data-pan-y={view.y} viewBox={`${baseBox.x} ${baseBox.y} ${baseBox.width} ${baseBox.height}`} aria-label="개념 사이의 관계 지도. 노드를 선택하면 상세 기록을 볼 수 있습니다." onPointerDown={e => begin(e)} onPointerMove={move} onPointerUp={e => end(e)} onPointerCancel={e => end(e, true)} onLostPointerCapture={e => end(e, true)} style={{ touchAction: 'none' }}>
      <defs>
        <marker id="hierarchy-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#91ad9b"/></marker>
        <filter id="node-shadow" x="-30%" y="-50%" width="160%" height="200%"><feDropShadow dx="0" dy="3" stdDeviation="5" floodColor="#243d33" floodOpacity="0.055" /></filter>
        <filter id="selected-shadow" x="-30%" y="-50%" width="160%" height="200%"><feDropShadow dx="0" dy="5" stdDeviation="10" floodColor="#245c4c" floodOpacity="0.13" /></filter>
      </defs>
      <g className="graph-viewport" transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}>
        {relations.map(r => {
          const a = layout[r.source_id], b = layout[r.target_id];
          if (!a || !b) return null;
          const connected = r.source_id === selectedId || r.target_id === selectedId;
          const source = concepts.find(c => c.id === r.source_id), target = concepts.find(c => c.id === r.target_id);
          const muted = !visibility(source) || !visibility(target);
          return <g key={r.id} className="graph-edge" opacity={muted ? .12 : selectedId && !connected ? .32 : 1}>
            <path markerEnd={r.type==='parent_of'?'url(#hierarchy-arrow)':undefined} d={r.type==='parent_of'?`M${a.x},${a.y+(roots.has(r.source_id)?39:27)*(b.y>=a.y?1:-1)} C${a.x},${(a.y+b.y)/2} ${b.x},${(a.y+b.y)/2} ${b.x},${b.y-(roots.has(r.target_id)?42:30)*(b.y>=a.y?1:-1)}`:`M${a.x},${a.y} C${a.x + (b.x - a.x) * .45},${a.y} ${b.x - (b.x - a.x) * .45},${b.y} ${b.x},${b.y}`}  fill="none" stroke={connected ? '#93b6a9' : '#c8d2ca'} strokeWidth={connected ? 1.8 : 1.3} />
            {connected && <circle cx={(a.x + b.x) / 2} cy={(a.y + b.y) / 2} r="3" fill="#9ab9ac" />}
          </g>;
        })}
        {concepts.map(c => {
          const p = layout[c.id];
          const isSelected = selectedId === c.id;
          const isNeighbor = neighbors.has(c.id);
          const visible = visibility(c);
          const isRoot=roots.has(c.id),nodeHeight=isRoot?78:54;
          const color = c.color || colorFor(c.category, categories);
          const textWidth = Math.min(isRoot?300:260, Math.max(isRoot?166:100, [...c.title].reduce((sum, ch) => sum + (/[^\x00-\x7F]/.test(ch) ? 14 : 7.5), 0) * (isRoot?1.12:1) + 57));
          return <g key={c.id} transform={`translate(${p.x} ${p.y})`} className={`graph-node ${isRoot?'root-node':''} ${isSelected ? 'selected' : ''} ${!visible || selectedId && !isSelected && !isNeighbor ? 'muted' : ''}`} opacity={!visible ? .14 : selectedId && !isSelected && !isNeighbor ? .6 : 1} onPointerDown={e => begin(e, c.id)} role="button" tabIndex={visible ? 0 : -1} aria-label={`${c.title}${isRoot?', 최상위 개념':''}, ${c.entry_count || 0}개의 기록`} aria-pressed={isSelected} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(c.id===selectedId?null:c.id); } }}>
            {isSelected && <rect x={-textWidth / 2 - 7} y={-nodeHeight/2-7} width={textWidth + 14} height={nodeHeight+14} rx="16" fill="none" stroke="#c5dcd1" strokeWidth="1" />}
            <rect x={-textWidth / 2} y={-nodeHeight/2} width={textWidth} height={nodeHeight} rx={isRoot?15:11} fill={isSelected ? '#285f50' : isRoot?'#e7f0df':'#fffefa'} stroke={isSelected ? '#285f50' : isRoot?'#7e9e69':'#dce2d9'} strokeWidth={isRoot?1.8:1.2} filter={`url(#${isSelected ? 'selected-shadow' : 'node-shadow'})`} />
            {isRoot&&<text x={-textWidth/2+20} y={-18} fontSize={9} fontWeight={600} letterSpacing={1} fill={isSelected?'#b8d6a8':'#6f8a59'}>최상위 개념</text>}
            <circle cx={-textWidth / 2 + 21} cy={isRoot?9:0} r={isRoot?5.5:4.3} fill={isSelected ? '#9ad0b3' : color} />
            <text x={-textWidth / 2 + 35} y={isRoot?10:1} fill={isSelected ? '#ffffff' : '#344139'} fontSize={isRoot?16:14} fontWeight={isRoot?'700':isSelected?'600':'500'} dominantBaseline="middle">{c.title.length > 22 ? `${c.title.slice(0, 21)}…` : c.title}</text>
            {isSelected && <text x="0" y={nodeHeight/2+24} textAnchor="middle" fontSize="10.5" fill="#7a8d80" letterSpacing=".5">{c.entry_count || 0}개의 기록 · {c.category || '미분류'}</text>}
          </g>;
        })}
      </g>
    </svg>
    <div className="graph-bottom">
      <div className="canvas-legend">{categories.slice(0, 4).map(cat => <span className="legend-item" key={cat}><i className="legend-dot" style={{ background: colorFor(cat, categories) }} />{cat}</span>)}</div>
      <div className="zoom-controls"><button className={`gesture-mode-button ${placementMode ? '' : 'active'}`} aria-label="지도 이동 모드" aria-pressed={!placementMode} title="드래그로 지도 이동 · 클릭으로 개념 선택" onClick={() => { if (!pointers.current.size) setPlacementMode(false); }}><Hand size={14} /><span>이동</span></button><button className={`gesture-mode-button ${placementMode ? 'active' : ''}`} aria-label="노드 배치 모드" aria-pressed={placementMode} title="노드를 드래그해 위치 변경" onClick={() => { if (!pointers.current.size) setPlacementMode(true); }}><Move size={14} /><span>배치</span></button><span className="control-divider" /><button className="icon-button" aria-label="축소" onClick={() => zoom(.85)}><ZoomOut size={16} /></button><span className="zoom-value">{Math.round(view.scale * 100)}%</span><button className="icon-button" aria-label="확대" onClick={() => zoom(1.18)}><ZoomIn size={16} /></button><span className="control-divider" /><button className="icon-button" aria-label="지도 전체 보기" title="지도 전체 보기" onClick={fit}><Focus size={17} /></button></div>
    </div>
    {(query || category) && <div className="graph-count">{visibleCount}개의 개념이 일치합니다</div>}
  </>;
}

function Evidence({ ids = [], onEvidence }) {
  if (!ids.length) return null;
  return <span className="evidence-links">{ids.slice(0, 4).map((id, index) => <button key={id} className="evidence-chip" title="근거 기록 보기" onClick={() => onEvidence(id)}>[{index + 1}]</button>)}</span>;
}

function Details({ concept, data, select, addEntry, addTerm, editConcept, editTerm, editEntry, removeTerm, removeEntry, highlightTerm, highlightEntry, termFocus, connect, close, summarize, busy }) {
  const [tab, setTab] = useState('overview');
  const [expandedTerms, setExpandedTerms] = useState(new Set());
  useEffect(() => { setTab('overview'); setExpandedTerms(new Set()); }, [concept?.id]);
  const terms=collectTerms(concept);
  useEffect(()=>{if(!concept||termFocus?.concept_id!==concept.id)return;const index=terms.findIndex(t=>t.id===termFocus.term_id);if(index<0)return;setTab('overview');setExpandedTerms(new Set([index]));const timer=setTimeout(()=>document.getElementById('term-'+termFocus.term_id)?.scrollIntoView({behavior:'smooth',block:'center'}),60);return()=>clearTimeout(timer);},[concept?.id,termFocus?.nonce]);
  if (!concept) return <aside className="detail-panel detail-placeholder"><div className="placeholder-icon"><BookOpen size={26} strokeWidth={1.4} /></div><h2>하나의 개념, 깊어지는 이해</h2><p>지도의 노드를 선택해 보세요.<br />현재의 이해와 쌓아온 기록이 여기에 나타납니다.</p><span className="placeholder-note"><GitBranch size={14} /> 연결을 따라 새로운 관점을 발견하세요</span></aside>;
  const entries = data.entries.filter(e => (e.concept_ids || []).includes(concept.id)).sort((a, b) => new Date(b.recorded_at) - new Date(a.recorded_at));
  const summary = concept.summary;
  const stale = summary && Number(summary.revision) < Number(concept.revision);
  const jobs = data.jobs.filter(j => j.concept_id === concept.id);
  const pending = jobs.some(j => ['queued', 'pending', 'running', 'processing'].includes(j.status));
  const latestJob = jobs.slice().sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))[0];
  const relatedIds = [...new Set([
    ...data.relations.flatMap(r => r.source_id === concept.id ? [r.target_id] : r.target_id === concept.id ? [r.source_id] : []),
    ...(summary?.related_concept_ids || []),
  ])].filter(id => id !== concept.id);
  const related = relatedIds.map(id => data.concepts.find(c => c.id === id)).filter(Boolean);
  const evidence = id => {
    setTab('timeline');
    setTimeout(() => {
      const node = document.getElementById(`entry-${id}`);
      node?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (node) { node.classList.add('evidence-highlight'); setTimeout(() => node.classList.remove('evidence-highlight'), 2500); }
    }, 80);
  };
  const showOverview = tab === 'overview';
  return <aside className="detail-panel">
    <div className="detail-head">
      <div className="detail-eyebrow"><span><span className="category-dot" style={{ background: concept.color || '#568975' }} />{concept.category || '미분류'}</span><button className="icon-button" onClick={close} aria-label="상세 닫기"><X size={17} /></button></div>
      <div className="detail-title-row"><h2 className="detail-title">{concept.title}</h2><button className="section-action" aria-label="개념 수정" onClick={editConcept}><Pencil size={13}/>수정</button></div>
      {!!concept.aliases?.length && <div className="detail-aliases">{concept.aliases.join(' · ')}</div>}
      <div className="detail-meta"><span><FileText size={12} />{entries.length}개의 기록</span><span><GitBranch size={12} />{related.length}개의 연결</span></div>
      <div className="detail-tabs"><button className={`detail-tab ${showOverview ? 'active' : ''}`} onClick={() => setTab('overview')}><Layers3 size={14} /> 개요</button><button className={`detail-tab ${!showOverview ? 'active' : ''}`} onClick={() => setTab('timeline')}><Clock3 size={14} /> 기록 <span>{entries.length}</span></button></div>
    </div>
    <div className="detail-body">
      {showOverview && <>
        <section className="detail-section summary-section">
          <div className="section-heading"><h3 className="section-title"><Sparkles size={15} className="section-icon" />현재의 이해</h3><button className={`section-action ${pending ? 'spinning-soft' : ''}`} title="Codex 요약 재생성" disabled={busy || pending || !entries.length} onClick={() => summarize(concept.id)}><RefreshCw size={13} />{pending ? '대기 중' : '갱신'}</button></div>
          {summary ? <>
            <p className="summary-text">{summary.overview}<Evidence ids={summary.evidence_ids} onEvidence={evidence} /></p>
            {!!summary.changes?.length && <div className="highlight-box"><span className="highlight-label"><Sprout size={12} />달라진 이해</span>{(Array.isArray(summary.changes) ? summary.changes : [summary.changes]).map((item, i) => <p key={i}>{typeof item === 'string' ? item : item.description || item.title}</p>)}</div>}
            <div className="summary-caption"><span className={`status-dot ${stale ? 'amber' : ''}`} />{stale ? '새 기록이 아직 반영되지 않았어요' : '누적 기록을 바탕으로 정리했어요'}<span>{relativeTime(summary.generated_at)}</span></div>
          </> : <>
            {concept.description && <p className="summary-text concept-description">{concept.description}</p>}
            <div className="waiting-notice"><Sparkles size={17} /><div><strong>{entries.length ? '기록이 쌓였어요. 요약을 기다리고 있어요.' : '첫 기록에서 이해가 시작돼요.'}</strong><p>{entries.length ? 'Codex 작업자가 연결되면 근거가 있는 요약과 용어 설명이 이곳에 나타납니다.' : '메모나 읽은 자료를 추가하면 Codex가 현재의 이해를 정리합니다.'}</p></div></div>
          </>}
          {latestJob?.status === 'failed' && <p className="job-error">최근 요약 작업에 실패했어요. 기록은 안전하게 저장되어 있습니다.</p>}
        </section>
        <section className="detail-section">
          <div className="section-heading"><h3 className="section-title"><BookOpen size={15} className="section-icon" />용어와 특징</h3><button className="section-action" aria-label="용어 추가" onClick={addTerm}><Plus size={13}/>용어 추가</button></div>
          {terms.length ? <div className="term-list">{terms.map((term, i) => <div id={`term-${term.id}`} className={`term-item ${term.highlighted?'is-important':''} ${termFocus?.term_id===term.id?'term-focused':''}`} key={term.id}><div className="term-heading-row"><button className="term-top" onClick={() => setExpandedTerms(previous => { const next = new Set(previous); next.has(i) ? next.delete(i) : next.add(i); return next; })} aria-expanded={expandedTerms.has(i)}><span className="term-title">{term.term}<small className="term-origin">{term.source==='manual'?'직접 정리':term.source==='agent'?'AI 정리':'메모 요약'}</small></span><ChevronDown size={13} style={{ transform: expandedTerms.has(i) ? 'rotate(180deg)' : undefined }} /></button><button className={`icon-button highlight-action ${term.highlighted?'active':''}`} aria-label={`${term.term} 중요 표시${term.highlighted?' 해제':''}`} aria-pressed={!!term.highlighted} onClick={()=>highlightTerm(term)}><Highlighter size={13}/></button><button className="icon-button" aria-label={`${term.term} 용어 삭제`} onClick={()=>removeTerm(term)}><Trash2 size={13}/></button><button className="icon-button term-edit" aria-label={`${term.term} 용어 수정`} onClick={()=>editTerm(term)}><Pencil size={13}/></button></div><div className={`term-definition ${expandedTerms.has(i) ? 'expanded' : ''}`}>{term.aliases?.length>0&&<span className="term-aliases">{term.aliases.join(' · ')}</span>}<Markdown text={term.definition}/><Evidence ids={term.evidence_ids} onEvidence={evidence} /></div>{term.concept_id && data.concepts.some(c => c.id === term.concept_id) && <button className="section-action term-node-link" onClick={() => select(term.concept_id)}>개념으로 이동 <ArrowUpRight size={12} /></button>}</div>)}</div> : <p className="muted-copy section-empty">세부 용어는 이 노드 안에 정리해요. 직접 추가하거나 에이전트에게 맡겨보세요.</p>}
          {!!summary?.features?.length && <div className="feature-list">{summary.features.map((feature, i) => <div className="feature-item" key={i}><Check size={12} className="feature-icon" /><div><strong>{feature.title}</strong><p>{feature.description}<Evidence ids={feature.evidence_ids} onEvidence={evidence} /></p></div></div>)}</div>}
        </section>
        <section className="detail-section">
          <div className="section-heading"><h3 className="section-title"><GitBranch size={15} className="section-icon" />이어지는 개념</h3><button className="section-action" onClick={connect}><Plus size={13} />연결</button></div>
          {related.length ? <div className="related-chips">{related.map(c => <button className="concept-chip" key={c.id} onClick={() => select(c.id)}>{c.title}<ArrowUpRight size={11} /></button>)}</div> : <p className="muted-copy section-empty">관련된 개념을 연결해 지식을 넓혀보세요.</p>}
        </section>
      </>}
      <section className={`detail-section timeline-section ${!showOverview ? 'timeline-full' : ''}`}>
        <div className="section-heading timeline-heading"><h3 className="section-title"><Clock3 size={15} className="section-icon" />쌓아온 기록 <span className="inline-count">{entries.length}</span></h3><button className="section-action" onClick={addEntry}><Plus size={13} />추가</button></div>
        <p className="timeline-description">생각의 흔적을, 최신 기록부터.</p>
        {entries.length ? <div className="timeline-list">{entries.slice(0, showOverview ? 3 : undefined).map(entry => {
          const url = safeUrl(entry.url);
          return <article className="timeline-item" id={`entry-${entry.id}`} key={entry.id}>
            <span className="timeline-dot" /><div className="timeline-date">{dateLabel(entry.recorded_at)}<span>{entry.source === 'web' || !entry.source ? '직접 기록' : entry.source === 'codex' ? 'Codex' : entry.source}</span></div>
            <div className={`timeline-card ${entry.highlighted?'is-important':''}`}><div className="entry-actions"><button className={`icon-button highlight-action ${entry.highlighted?'active':''}`} aria-label={`${entry.title||'제목 없는 기록'} 중요 표시${entry.highlighted?' 해제':''}`} aria-pressed={!!entry.highlighted} onClick={()=>highlightEntry(entry)}><Highlighter size={13}/></button><button className="icon-button" aria-label={`${entry.title||'제목 없는 기록'} 삭제`} onClick={()=>removeEntry(entry)}><Trash2 size={13}/></button><button className="section-action entry-edit" aria-label={`${entry.title||'제목 없는 기록'} 수정`} onClick={()=>editEntry(entry)}><Pencil size={12}/>수정</button></div>{entry.title && <h4 className="entry-title">{entry.title}</h4>}<Markdown className="entry-content" text={entry.content}/>{url && <a className="source-link" href={url} target="_blank" rel="noopener noreferrer"><Link2 size={12} /><span>{new URL(url).hostname.replace('www.', '')}</span><ExternalLink size={11} /></a>}{entry.subject_period && <div className="entry-footer"><span className="period-tag">다루는 시기 · {entry.subject_period}</span></div>}</div>
          </article>;
        })}</div> : <div className="empty-timeline"><FileText size={20} strokeWidth={1.4} /><p>아직 기록이 없어요.</p><button className="button secondary small" onClick={addEntry}><Plus size={13} />첫 기록 추가</button></div>}
        {showOverview && entries.length > 3 && <button className="view-all-records" onClick={() => setTab('timeline')}>기록 {entries.length}개 모두 보기<ArrowRight size={13} /></button>}
      </section>
    </div>
    <div className="detail-footer"><button className="button primary" onClick={addEntry}><Plus size={15} />이 개념에 기록 추가</button><span>작은 메모 하나가, 다음 연결이 됩니다.</span></div>
  </aside>;
}

function ConceptForm({ categories, close, onSave, busy, initial }) {
  const [form, setForm] = useState({ title: initial?.title||'', category: initial?.category||categories[0]||'시스템 설계', description: initial?.description||'', aliases: (initial?.aliases||[]).join(', ') });
  const [error, setError] = useState('');
  const submit = async e => { e.preventDefault(); setError(''); try { await onSave({ ...form, title: form.title.trim(), aliases: form.aliases.split(',').map(s => s.trim()).filter(Boolean) }); } catch (e) { setError(e.message); } };
  return <Modal title={initial?'개념 수정':'새로운 개념'} subtitle={initial?'이름, 주제, 설명과 별칭을 고칠 수 있어요.':'더 알아가고 싶은 주제를 지도에 놓아보세요.'} close={close}>
    <form onSubmit={submit} className="form-stack"><Field label="개념 이름"><input className="input" required maxLength={200} placeholder="예: 이벤트 기반 아키텍처" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></Field><Field label="큰 주제" help="DB처럼 개념들을 묶는 주제예요."><input className="input" list="categories" required maxLength={80} value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} /><datalist id="categories">{[...new Set([...categories, ...DEFAULT_CATEGORIES])].map(c => <option key={c} value={c} />)}</datalist></Field><Field label="지금의 짧은 설명" help="선택 사항 · 앞으로 쌓을 기록의 출발점이에요."><textarea className="textarea" rows={3} placeholder="이 개념을 어떻게 이해하고 있나요?" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></Field><Field label="다른 이름" help="쉼표로 구분해요. 검색할 때 함께 찾을 수 있어요."><input className="input" placeholder="예: EDA, Event-driven architecture" value={form.aliases} onChange={e => setForm({ ...form, aliases: e.target.value })} /></Field>{error && <p className="form-error" role="alert">{error}</p>}<div className="form-actions"><button type="button" className="button secondary" onClick={close}>취소</button><button className="button primary" disabled={busy || !form.title.trim()}>{busy ? <Loader2 className="spin" size={15} /> : <Plus size={15} />}{initial?'변경 저장':'개념 만들기'}</button></div></form>
  </Modal>;
}

function TermForm({concept,close,onSave,busy,initial}) {
  const [form,setForm]=useState({term:initial?.term||'',definition:initial?.definition||'',aliases:(initial?.aliases||[]).join(', ')});const [error,setError]=useState('');
  return <Modal title={initial?'용어 수정':'노드 안에 용어 정리'} subtitle={`${concept.title} 안에서 설명할 세부 개념을 적어주세요.`} close={close}><form onSubmit={async e=>{e.preventDefault();setError('');try{await onSave({...form,aliases:form.aliases.split(',').map(s=>s.trim()).filter(Boolean)});}catch(e){setError(e.message);}}}><Field label="용어 이름"><input className="input" required maxLength={200} placeholder="예: Pod" value={form.term} onChange={e=>setForm({...form,term:e.target.value})}/></Field><Field label="용어 설명"><textarea className="textarea" required maxLength={2000} rows={4} value={form.definition} onChange={e=>setForm({...form,definition:e.target.value})}/></Field><Field label="용어의 다른 이름" help="쉼표로 구분해요. 검색할 때 함께 찾을 수 있어요."><input className="input" value={form.aliases} onChange={e=>setForm({...form,aliases:e.target.value})}/></Field>{error&&<p className="form-error" role="alert">{error}</p>}<div className="form-actions"><button className="button secondary" type="button" onClick={close}>취소</button><button className="button primary" disabled={busy||!form.term.trim()||!form.definition.trim()}>{busy?<Loader2 size={14} className="spin"/>:<Plus size={14}/>}용어 저장</button></div></form></Modal>;
}

function EntryForm({ concepts, selectedId, close, onSave, busy, initial }) {
  const [form, setForm] = useState({ concept_ids: initial?.concept_ids||(selectedId?[selectedId]:[]), title: initial?.title||'', content: initial?.content||'', url: initial?.url||'', subject_period: initial?.subject_period||'' });
  const [error, setError] = useState('');
  const submit = async e => { e.preventDefault(); setError(''); if (form.url && !safeUrl(form.url)) return setError('http 또는 https로 시작하는 올바른 링크를 입력해주세요.'); try { await onSave({ ...form, source: 'web' }); } catch (e) { setError(e.message); } };
  return <Modal title={initial?'기록 수정':'생각을 기록하기'} subtitle={initial?'원래 기록 날짜를 유지하며 수정해요. 요약은 다시 정리됩니다.':'메모도, 읽은 링크도. 지금의 이해를 남겨보세요.'} close={close}>
    <form onSubmit={submit} className="form-stack"><Field label="연결할 개념" group><div className="concept-select-list">{concepts.map(c => <label className={`concept-check ${form.concept_ids.includes(c.id) ? 'checked' : ''}`} key={c.id}><input type="checkbox" checked={form.concept_ids.includes(c.id)} onChange={e => setForm({ ...form, concept_ids: e.target.checked ? [...form.concept_ids, c.id] : form.concept_ids.filter(id => id !== c.id) })} /><span>{c.title}</span>{form.concept_ids.includes(c.id) && <Check size={12} />}</label>)}</div></Field><Field label="제목 · 선택 사항"><input className="input" maxLength={200} placeholder="예: 실제로 적용해보고 알게 된 것" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></Field><div className="field"><span className="field-label">기록</span><MarkdownEditor value={form.content} onChange={content=>setForm({...form,content})}/></div><div className="form-row"><Field label="출처 링크"><input className="input" type="url" placeholder="https://" value={form.url} onChange={e => setForm({ ...form, url: e.target.value })} /></Field><Field label="내용이 다루는 시기 · 선택 사항"><input className="input" maxLength={100} placeholder="예: 2020년대" value={form.subject_period} onChange={e => setForm({ ...form, subject_period: e.target.value })} /></Field></div><p className="field-help">링크와 메모가 저장됩니다. 링크의 본문을 자동으로 읽지는 않아요.</p>{error && <p className="form-error" role="alert">{error}</p>}<div className="form-actions"><button type="button" className="button secondary" onClick={close}>취소</button><button className="button primary" disabled={busy || (!form.content.trim() && !form.url.trim()) || !form.concept_ids.length}>{busy ? <Loader2 className="spin" size={15} /> : <Plus size={15} />}기록 저장</button></div></form>
  </Modal>;
}

function RelationForm({ concept, concepts, close, onSave, busy }) {
  const [target, setTarget] = useState('');
  const [type, setType] = useState('related');
  const [error, setError] = useState('');
  return <Modal title="개념을 연결하기" subtitle={`‘${concept.title}’에서 이어지는 생각을 찾아보세요.`} close={close}><form className="form-stack" onSubmit={async e => { e.preventDefault(); try { await onSave({ source_id: concept.id, target_id: target, type }); } catch (e) { setError(e.message); } }}><Field label="연결할 개념"><select className="input select" required value={target} onChange={e => setTarget(e.target.value)}><option value="">개념 선택</option>{concepts.filter(c => c.id !== concept.id).map(c => <option value={c.id} key={c.id}>{c.title}</option>)}</select></Field><Field label="관계"><select className="input select" value={type} onChange={e => setType(e.target.value)}>{RELATION_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>{error && <p className="form-error" role="alert">{error}</p>}<div className="form-actions"><button type="button" className="button secondary" onClick={close}>취소</button><button className="button primary" disabled={busy || !target}><Link2 size={15} />연결 만들기</button></div></form></Modal>;
}

function CodeBlock({ children, notify }) {
  return <div className="code-block"><pre>{children}</pre><button className="code-copy icon-button" title="명령 복사" aria-label="명령 복사" onClick={() => copyText(children).then(() => notify('복사했어요.')).catch(() => notify('복사하지 못했어요. 텍스트를 선택해 복사해주세요.'))}><Copy size={14} /></button></div>;
}

function ApiGuide({ close, notify }) {
  const [tab, setTab] = useState('connect');
  const [tokens, setTokens] = useState([]);
  const [name, setName] = useState('내 Codex');
  const [secret, setSecret] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const origin = window.location.origin;
  const load = useCallback(() => request('/settings').then(result => setTokens(result.tokens || [])).catch(e => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);
  const create = async e => { e.preventDefault(); setLoading(true); setError(''); try { const result = await request('/tokens', { method: 'POST', body: JSON.stringify({ name }) }); setSecret(result.token); await load(); } catch (e) { setError(e.message); } finally { setLoading(false); } };
  return <Modal title="도구에서 지식 쌓기" subtitle="Codex, 터미널, 나만의 도구를 같은 지식 지도에 연결하세요." close={close} wide>
    <div className="tabs"><button className={`tab ${tab === 'connect' ? 'active' : ''}`} onClick={() => setTab('connect')}><Terminal size={14} />CLI · Codex</button><button className={`tab ${tab === 'api' ? 'active' : ''}`} onClick={() => setTab('api')}><Code2 size={14} />REST API</button><button className={`tab ${tab === 'tokens' ? 'active' : ''}`} onClick={() => setTab('tokens')}><Settings2 size={14} />API 토큰</button></div>
    {tab === 'connect' && <div className="api-section"><h3>작업하는 곳에서 바로 기록하세요.</h3><p>프로젝트에 포함된 CLI를 내려받아 사이트 주소와 인증 정보를 설정하세요.</p><CodeBlock notify={notify}>{`node cli/kg.mjs configure --site ${origin}`}</CodeBlock><a className="download-link" href="/downloads/synapse-cli.zip" download><ArrowDownToLine size={14} />CLI와 Codex 작업자 내려받기<ArrowUpRight size={12} /></a><p className="field-help">아래에서 만든 앱 API 토큰이 필요해요. 비공개 Sites에서는 접근 토큰도 필요합니다. 전체 설정은 다운로드한 README를 참고하세요.</p><h3>생각이 생긴 순간, 한 줄로.</h3><CodeBlock notify={notify}>{`node cli/kg.mjs search "시스템 설계"\nnode cli/kg.mjs add --concept <node-id> --file notes.md`}</CodeBlock><div className="setup-notice"><Sparkles size={18} /><div><strong>자동 요약에는 Codex 작업자가 필요해요.</strong><p>Codex가 로그인된 PC나 서버에서 실행해 두세요. 연결되지 않아도 기록은 저장되고, 작업자가 연결되면 순서대로 요약합니다.</p></div></div><CodeBlock notify={notify}>{`npm install\nnode cli/kg.mjs worker`}</CodeBlock></div>}
    {tab === 'api' && <div className="api-section"><h3>모든 기록은 같은 API로 연결됩니다.</h3><p>API는 JSON을 사용합니다. 기록 저장 시 요약 작업도 함께 등록됩니다. 비공개 Sites에서는 OAI-Sites-Authorization 헤더도 함께 보내주세요.</p><CodeBlock notify={notify}>{`POST ${origin}/api/v1/entries\nAuthorization: Bearer <APP_API_TOKEN>\nIdempotency-Key: <unique-request-id>\nContent-Type: application/json\n\n{\n  "concept_ids": ["<node-id>"],\n  "content": "작업하면서 새로 알게 된 점",\n  "source": "codex"\n}`}</CodeBlock><div className="api-endpoints">{[['GET', '/concepts?q=검색어', '개념 찾기'], ['POST', '/concepts', '개념 만들기'], ['POST', '/entries', '기록 추가'], ['POST', '/relations', '개념 연결'], ['GET', '/concepts/:id', '개념과 현재 이해'], ['GET', '/export', '전체 기록 내보내기']].map(([method, route, label]) => <div key={route}><code>{method}</code><span>{route}</span><small>{label}</small></div>)}</div><a className="download-link" href="/api/v1/openapi.json" target="_blank" rel="noreferrer"><Code2 size={14} />OpenAPI 명세 보기<ArrowUpRight size={12} /></a></div>}
    {tab === 'tokens' && <div className="api-section"><h3>앱 API 토큰</h3><p>외부 도구가 내 지식에 접근할 때 사용해요. 도구별로 발급하면 필요할 때 개별적으로 해제할 수 있습니다.</p><form className="inline-form" onSubmit={create}><input className="input" aria-label="토큰 이름" required maxLength={80} value={name} onChange={e => setName(e.target.value)} placeholder="토큰 이름" /><button className="button primary" disabled={loading}>{loading ? <Loader2 className="spin" size={14} /> : <Plus size={14} />}토큰 만들기</button></form>{secret && <div className="secret-box"><strong><Check size={14} />토큰을 만들었어요. 지금 복사해 보관하세요.</strong><p>이 화면을 닫으면 전체 토큰을 다시 볼 수 없어요.</p><CodeBlock notify={notify}>{secret}</CodeBlock></div>}<div className="token-list">{tokens.length ? tokens.map(token => <div className="token-row" key={token.id}><div className="token-info"><strong>{token.name}</strong><span className="token-date">{dateLabel(token.created_at)} 생성</span></div><button className="icon-button danger" title="토큰 해제" aria-label={`${token.name} 토큰 해제`} onClick={async () => { try { await request(`/tokens/${encodeURIComponent(token.id)}`, { method: 'DELETE' }); await load(); notify('토큰을 해제했어요.'); } catch (e) { setError(e.message); } }}><Trash2 size={15} /></button></div>) : <div className="empty-tokens">발급된 앱 API 토큰이 없습니다.</div>}</div><div className="setup-notice"><CircleHelp size={17} /><div><strong>내 기록은 개인 API 토큰으로 연결해요.</strong><p>공개 사이트에서는 앱 API 토큰으로 내 기록에 접근합니다. 비공개 Sites에서는 Sites 접근 토큰도 필요하며 get_site에서 확인할 수 있어요.</p></div></div></div>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </Modal>;
}

function SignIn() {
  const [github,setGithub]=useState(false);
  const [available,setAvailable]=useState(null);
  useEffect(()=>{fetch('/auth/config').then(r=>r.json()).then(d=>setAvailable(d.github)).catch(()=>setAvailable(false));},[]);
  return <main className="auth-page">
    <header className="auth-header"><a className="brand auth-brand" href="/" aria-label="Synapse 홈"><span className="brand-mark"><Network size={23} strokeWidth={1.7} /></span><div><span className="brand-word">synapse<span>.</span></span><span className="brand-kicker">YOUR KNOWLEDGE, CONNECTED</span></div></a><span className="auth-header-note">나만의 지식 지도</span></header>
    <section className="auth-content" aria-labelledby="auth-title">
      <div className="auth-intro"><span className="auth-eyebrow"><Sprout size={15} />생각이 쌓이고, 이해가 연결되는 곳</span><h1 id="auth-title">흩어진 지식을<br />나만의 지도로.</h1><p>개념 사이의 연결을 발견하고,<br />메모와 링크로 이해의 변화를 쌓아가세요.</p><div className="auth-features"><div><Network size={20} /><strong>개념 지도</strong><span>큰 주제부터 작은 연결까지</span></div><div><Clock3 size={20} /><strong>지식 타임라인</strong><span>시간과 함께 쌓이는 이해</span></div><div><Terminal size={20} /><strong>CLI · Codex 연결</strong><span>작업하는 곳에서 바로 기록</span></div></div></div>
      <div className="auth-card"><span className="auth-card-icon"><BookOpen size={28} strokeWidth={1.5} /></span><h2>나의 지식 공간 시작하기</h2><p>GitHub 또는 ChatGPT로 로그인하고<br />첫 번째 개념을 지도에 놓아보세요.</p><button className="button github-signin auth-signin" disabled={!available} onClick={()=>setGithub(true)}><Github size={18}/>GitHub로 시작하기<ArrowRight size={17}/></button>{available===false&&<p className="field-help">GitHub 로그인은 앱 등록을 마치면 사용할 수 있어요.</p>}<a href="/signin-with-chatgpt?return_to=%2F" target="_top" className="button secondary auth-signin">ChatGPT로 시작하기<ArrowRight size={17} /></a><p className="auth-privacy"><Check size={14} />로그인한 계정의 기록만 표시됩니다.</p></div>
    </section>{github&&<GithubLogin onClose={()=>setGithub(false)} onSuccess={()=>window.location.reload()}/>}<footer className="auth-footer">작은 생각들이 연결되어 나만의 지도가 됩니다.</footer>
  </main>;
}

export default function App() {
  const panels=usePanelWidths();
  const [data, setData] = useState({ concepts: [], relations: [], entries: [], jobs: [], user: null });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [authenticationRequired, setAuthenticationRequired] = useState(false);
  const [selectedId, setSelectedId] = useState(selectedFromHash);
  const [view, setView] = useState('main');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState(null);
  const [modal, setModal] = useState(null);
  const [editing,setEditing]=useState(null);
  const [agentOpen,setAgentOpen]=useState(false);
  const [graphReset,setGraphReset]=useState(0);
  const [termFocus,setTermFocus]=useState(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const toastTimer = useRef(null);
  const searchRef = useRef(null);
  const categories = useMemo(() => [...new Set(data.concepts.map(c => c.category || '미분류'))], [data.concepts]);
  const selected = data.concepts.find(c => c.id === selectedId);
  const notify = useCallback(message => { setToast(message); clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(''), 3800); }, []);
  const refresh = useCallback(async (quiet = false) => {
    try {
      const result = await request('/bootstrap');
      setData({ ...result, concepts: result.concepts || [], relations: result.relations || [], entries: result.entries || [], jobs: result.jobs || [] });
      setLoadError('');
      setAuthenticationRequired(false);
      return result;
    } catch (e) {
      if (e.status === 401) {
        setData({ concepts: [], relations: [], entries: [], jobs: [], user: null });
        setSelectedId(null); setModal(null); setToast(''); setQuery(''); setCategory(null); setView('main');
        setAuthenticationRequired(true); setLoadError('');
      } else if (!quiet) setLoadError(e.message);
      throw e;
    }
    finally { if (!quiet) setLoading(false); }
  }, []);
  useEffect(() => { refresh().catch(() => {}); return () => clearTimeout(toastTimer.current); }, [refresh]);
  useEffect(() => {
    const onHash = () => { setSelectedId(selectedFromHash()); setView('main'); setCategory(null); };
    const onKey = e => { if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); searchRef.current?.focus(); } };
    window.addEventListener('hashchange', onHash); document.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('hashchange', onHash); document.removeEventListener('keydown', onKey); };
  }, []);
  const hasPendingJobs = data.jobs.some(j => ['queued', 'pending', 'running', 'processing'].includes(j.status));
  useEffect(() => { if (!hasPendingJobs) return; const timer = setInterval(() => refresh(true).catch(() => {}), 8000); return () => clearInterval(timer); }, [hasPendingJobs, refresh]);
  const select = useCallback(id => {
    const concept = data.concepts.find(c => c.id === id);
    if (id && (view === 'topics' || view === 'recent' || (view === 'topic' && concept && (concept.category || '미분류') !== category))) { setView('main'); setCategory(null); }
    setSelectedId(id);
    window.history.pushState(null, '', id ? `#concept/${encodeURIComponent(id)}` : window.location.pathname + window.location.search);
  }, [data.concepts, view, category]);
  const navigate = next => { select(null); setView(next); setCategory(null); setQuery(''); };
  const openTopic = cat => { select(null); setView('topic'); setCategory(cat); setQuery(''); };
  const openRecent = id => { setView('main'); setCategory(null); setQuery(''); select(id); };
  const save = async (path, body, success, method='POST') => {
    setBusy(true);
    try { const result = await request(path, { method, body: JSON.stringify(body) }); await refresh(true); setModal(null); notify(success); return result; }
    finally { setBusy(false); }
  };
  const loadDemo = async () => { setBusy(true); try { await request('/demo', { method: 'POST', body: '{}' }); await refresh(true); navigate('main'); notify('예시 지도를 불러왔어요. 개념별 지도에서 큰 주제도 둘러보세요.'); } catch (e) { notify(e.message); } finally { setBusy(false); } };
  const exportData = async () => { try { const result = await request('/export'); const url = URL.createObjectURL(new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = `synapse-${new Date().toISOString().slice(0, 10)}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); notify('지식 지도를 내보냈어요.'); } catch (e) { notify(e.message); } };
  const latestRecords = useMemo(() => {
    const result = new Map();
    for (const entry of data.entries) for (const id of entry.concept_ids || []) {
      const previous = result.get(id);
      if (!previous || entry.recorded_at > previous.recorded_at || (entry.recorded_at === previous.recorded_at && entry.id > previous.id)) result.set(id, entry);
    }
    return result;
  }, [data.entries]);
  const recent = useMemo(() => data.concepts.filter(c => latestRecords.has(c.id)).sort((a, b) => {
    const order = latestRecords.get(b.id).recorded_at.localeCompare(latestRecords.get(a.id).recorded_at);
    return order || a.id.localeCompare(b.id);
  }), [data.concepts, latestRecords]);
  const graphConcepts = view === 'topic' ? data.concepts.filter(c => (c.category || '미분류') === category) : data.concepts;
  const graphIds = new Set(graphConcepts.map(c => c.id));
  const graphRelations = view === 'topic' ? data.relations.filter(r => graphIds.has(r.source_id) && graphIds.has(r.target_id)) : data.relations;
  const matchesQuery = text => !query.trim() || text.toLowerCase().includes(query.trim().toLowerCase());
  const topics = categories.filter(cat => matchesQuery(cat));
  const displayedRecent = recent.filter(c => matchesQuery(`${c.title} ${c.category} ${latestRecords.get(c.id)?.content || ''}`));
  const title = view === 'topics' ? '큰 주제에서 시작하는 탐색' : view === 'recent' ? '최근 쌓아온 지식' : view === 'topic' ? `${category}의 개념 지도` : '연결하며 넓어지는 지식';
  const displayName = data.user?.name || '나의 워크스페이스';
  if (authenticationRequired) return <SignIn />;
  return <div className={`app ${selected ? 'has-selection' : ''} ${agentOpen ? 'has-agent' : ''} ${panels.expanded?'expanded-sidebar':''}`} style={panels.style}>
    <ResizeHandle {...panels.handle('left')}/>
    <aside className="sidebar">
      <a href="#" className="brand" onClick={e => { e.preventDefault(); navigate('main'); }} aria-label="Synapse 지식 지도 홈"><span className="brand-mark"><Network size={23} strokeWidth={1.7} /></span><div><span className="brand-word">synapse<span>.</span></span><span className="brand-kicker">YOUR KNOWLEDGE, CONNECTED</span></div></a>
      <div className="workspace-label"><span className="workspace-avatar">나</span><span className="hide-compact">나의 지식 공간</span><ChevronDown size={12} className="hide-compact" /></div>
      <nav className="nav-section" aria-label="주 탐색"><button className={`nav-button ${view === 'main' ? 'active' : ''}`} title="메인 지도" aria-label="메인 지도" onClick={() => navigate('main')}><Network className="nav-icon" size={17} /><span className="hide-compact">메인 지도</span><span className="count hide-compact">{data.concepts.length}</span></button></nav>
      <div className="nav-section categories-section"><button className={`nav-button ${view === 'topics' || view === 'topic' ? 'active' : ''}`} title="개념별 지도" aria-label="개념별 지도" onClick={() => navigate('topics')}><Layers3 className="nav-icon" size={17} /><span className="hide-compact">개념별 지도</span><span className="count hide-compact">{categories.length}</span></button><div className="topic-shortcuts">{categories.map((cat, index) => <button className={`category-button ${view === 'topic' && category === cat ? 'active' : ''}`} key={cat} onClick={() => openTopic(cat)} title={cat}><i className="category-dot" style={{ background: COLORS[index % COLORS.length] }} /><span className="hide-compact">{cat}</span><span className="category-count hide-compact">{data.concepts.filter(c => (c.category || '미분류') === cat).length}</span></button>)}</div><button className="add-category-button hide-compact" onClick={() => setModal('concept')}><Plus size={13} />주제와 개념 추가</button></div>
      <div className="nav-section recent-section"><button className={`nav-button ${view === 'recent' ? 'active' : ''}`} title="최근 기록한 지식" aria-label="최근 기록한 지식" onClick={() => navigate('recent')}><Clock3 className="nav-icon" size={17} /><span className="hide-compact">최근 기록한 지식</span></button><div className="hide-compact">{recent.length ? recent.slice(0, 6).map(c => <button className="recent-button recent-shortcut" key={c.id} onClick={() => openRecent(c.id)}><span className="recent-line" /><span>{c.title}</span><small>{relativeTime(latestRecords.get(c.id).recorded_at)}</small></button>) : <p className="sidebar-empty">첫 기록을 남기면<br />최근 지식이 여기에 나타나요.</p>}</div></div>
      <div className="sidebar-footer"><button className="nav-button" onClick={() => data.concepts.length ? setModal('entry') : setModal('concept')} title="새 기록 남기기"><FileText className="nav-icon" size={17} /><span className="hide-compact">새 기록 남기기</span><Plus size={13} className="hide-compact trailing-icon" /></button><button className="nav-button" onClick={() => setModal('api')} title="API · 도구 연결"><Terminal size={16} /><span className="hide-compact">API · 도구 연결</span><ArrowUpRight className="hide-compact trailing-icon" size={13} /></button><button className="nav-button" onClick={exportData} title="지식 내보내기"><ArrowDownToLine size={16} /><span className="hide-compact">지식 내보내기</span></button><button className="nav-button" onClick={()=>setModal('github')} title="GitHub 계정 연결"><Github size={16}/><span className="hide-compact">{data.user?.github_connected?'GitHub 연결됨':'GitHub 계정 연결'}</span></button><div className="profile"><div className="profile-avatar">{(data.user?.name || '나').slice(0, 1)}</div><div className="profile-text hide-compact"><strong>{displayName}</strong><span><span className="status-dot" />내 기록은 나에게만</span></div><button className="icon-button profile-more hide-compact" aria-label="로그아웃" title="로그아웃" onClick={async()=>{try{await authRequest('logout');window.top.location.href='/signout-with-chatgpt?return_to=%2F';}catch(e){notify(e.message);}}}><LogOut size={15}/></button></div></div>
    </aside>
    <main className="main">
      <header className="topbar"><div className="breadcrumb"><span>나의 지식 공간</span><ChevronRight size={11} /><strong>{view === 'main' ? '메인 지도' : view === 'recent' ? '최근 기록한 지식' : '개념별 지도'}</strong>{view === 'topic' && <><ChevronRight size={11} /><span>{category}</span></>}{data.demo && <span className="demo-badge">예시 데이터</span>}</div><div className="page-heading"><div className="heading-copy"><h1>{title}<span>.</span></h1><p>{view === 'topics' ? 'DB, 설계, 프론트엔드… 큰 주제로 지식을 모아보세요.' : view === 'recent' ? '마지막 기록을 기준으로, 최근의 지식부터.' : view === 'topic' ? '이 주제에 속한 개념과 연결을 한눈에 살펴보세요.' : '모든 주제의 개념과 연결을 한눈에 살펴보세요.'}</p></div><div className="top-actions"><KnowledgeSearch concepts={data.concepts} value={query} onChange={setQuery} inputRef={searchRef} onPick={r=>{setAgentOpen(false);setView('main');setCategory(null);setGraphReset(n=>n+1);select(r.concept_id);setTermFocus(r.type==='term'?{concept_id:r.concept_id,term_id:r.id,nonce:crypto.randomUUID()}:null);}}/><button className="button secondary top-agent" aria-label="그래프 에이전트 열기" onClick={()=>setAgentOpen(true)}><Sparkles size={15}/>에이전트</button><button className="button secondary top-api" onClick={() => setModal('api')}><Code2 size={15} />API</button><button className="button primary" onClick={() => data.concepts.length ? setModal('entry') : setModal('concept')}><Plus size={16} /><span>{data.concepts.length ? '기록 추가' : '개념 추가'}</span></button></div></div><nav className="mobile-view-nav" aria-label="모바일 탐색">{[['main','메인 지도',Network],['topics','개념별 지도',Layers3],['recent','최근 지식',Clock3]].map(([key,label,Icon]) => <button key={key} aria-label={key === 'recent' ? '최근 기록한 지식' : label} className={view === key || key === 'topics' && view === 'topic' ? 'active' : ''} onClick={() => navigate(key)}><Icon size={14} />{label}</button>)}</nav></header>
      <div className={`workspace ${view === 'topics' || view === 'recent' ? 'directory-workspace' : ''}`}>
        <section className={`graph-panel ${view === 'topics' || view === 'recent' ? 'directory-panel' : ''}`} aria-label={view === 'topics' ? '큰 주제 목록' : view === 'recent' ? '최근 기록한 지식 목록' : '지식 그래프'}>
          {loading ? <div className="loading-screen"><Loader2 size={24} className="spin" /><p>지식 지도를 펼치고 있어요.</p></div> : loadError ? <div className="empty-map error-map"><CircleHelp size={29} strokeWidth={1.4} /><h2 className="empty-title">지도를 불러오지 못했어요.</h2><p className="empty-description">{loadError}</p><button className="button primary" onClick={() => { setLoading(true); refresh().catch(() => {}); }}><RefreshCw size={15} />다시 시도</button></div> : view === 'topics' ? <div className="directory-content"><div className="directory-heading"><div><span className="directory-kicker">TOPIC MAPS</span><h2>개념별 지도 <small>{categories.length}</small></h2><p>큰 주제를 선택하면 그 안의 개념만 모아 보여드려요.</p></div><button className="button secondary small" onClick={() => setModal('concept')}><Plus size={14} />개념 추가</button></div>{topics.length ? <div className="topic-grid">{topics.map(cat => {
            const concepts = data.concepts.filter(c => (c.category || '미분류') === cat);
            const ids = new Set(concepts.map(c => c.id));
            const entries = data.entries.filter(e => e.concept_ids?.some(id => ids.has(id)));
            const latest = entries.reduce((value,e) => e.recorded_at > value ? e.recorded_at : value, '');
            return <button className="topic-card" aria-label={`${cat} 지도 열기`} key={cat} onClick={() => openTopic(cat)}><span className="topic-card-icon" style={{color:colorFor(cat,categories)}}><Layers3 size={22} strokeWidth={1.5}/></span><ArrowUpRight className="topic-card-arrow" size={17}/><h3>{cat}</h3><p>{concepts.slice(0,3).map(c=>c.title).join(' · ')}{concepts.length>3?' …':''}</p><div className="topic-card-meta"><span>{concepts.length}개 개념 · {entries.length}개 기록</span><small>{latest ? relativeTime(latest) : '첫 기록을 기다려요'}</small></div></button>;
          })}</div> : <div className="directory-empty"><Layers3 size={32}/><h3>{query ? '일치하는 주제가 없어요.' : '큰 주제로 지도를 나눠보세요.'}</h3><p>개념을 만들 때 큰 주제에 DB처럼 이름을 적어주세요.</p><button className="button primary" onClick={() => setModal('concept')}><Plus size={15}/>주제와 개념 추가</button></div>}</div> : view === 'recent' ? <div className="directory-content"><div className="directory-heading"><div><span className="directory-kicker">RECENT KNOWLEDGE</span><h2>최근 기록한 지식 <small>{recent.length}</small></h2><p>같은 개념은 한 번만, 마지막 기록이 최신인 순서로 보여요.</p></div></div>{displayedRecent.length ? <div className="recent-knowledge-list">{displayedRecent.map(c => { const entry = latestRecords.get(c.id); return <button className="recent-knowledge-card recent-knowledge-item" key={c.id} onClick={() => openRecent(c.id)}><span className="topic-card-icon" style={{color:c.color || colorFor(c.category,categories)}}><BookOpen size={20}/></span><div><span className="recent-category">{c.category || '미분류'}</span><h3>{c.title}</h3><p>{entry.title || entry.content || '출처 링크를 기록했어요.'}</p><time dateTime={entry.recorded_at}>{dateLabel(entry.recorded_at,true)}</time></div><ArrowUpRight size={17}/></button>; })}</div> : <div className="directory-empty"><Clock3 size={32}/><h3>{query ? '일치하는 지식이 없어요.' : '아직 쌓인 기록이 없어요.'}</h3><p>메모나 링크를 남기면 최근 지식이 이곳에 모입니다.</p><button className="button primary" onClick={() => setModal(data.concepts.length ? 'entry' : 'concept')}><Plus size={15}/>첫 기록 남기기</button></div>}</div> : <>
          <div className="graph-top"><div className="view-label"><Network size={15} /><strong>{view === 'topic' ? category : '전체 개념 지도'}</strong><span className="graph-meta">{graphConcepts.length} 개념<span>·</span>{graphRelations.length} 연결</span></div><div className="graph-filters">{view === 'topic' && <button className="filter-chip" onClick={() => navigate('topics')}><ArrowLeft size={11}/>주제 목록</button>}<button className="filter-chip active" onClick={() => navigate(view === 'topic' ? 'main' : 'topics')}>{view === 'topic' ? '전체 지도' : '개념별 지도'}<ArrowUpRight size={11}/></button></div></div>
          <div className="canvas-top-hint"><span className="hint-dot" />{view === 'topic' ? `${category}에 속한 개념만 보고 있어요` : selected ? '연결을 따라 생각을 넓혀보세요' : '모든 개념이 연결된 나의 전체 지도'}</div>
          {graphConcepts.length ? <Graph key={(view === 'topic' ? category : 'main')+':'+graphReset} concepts={graphConcepts} relations={graphRelations} hierarchyRelations={data.relations} selectedId={selectedId} onSelect={select} onPositionChange={(id, position) => request(`/concepts/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(position) }).catch(error => notify(`위치를 저장하지 못했어요. ${error.message}`))} query={query.trim()} category={null} categories={view === 'topic' ? [category] : categories} /> : <>
            <div className="empty-graph-decoration" aria-hidden="true"><span className="deco-node node-one"><span />나의 첫 개념</span><span className="deco-node node-two"><span />새로운 질문</span><span className="deco-node node-three"><span />다음 연결</span><svg viewBox="0 0 700 400"><path d="M210 130 C300 130 250 260 370 260 S480 170 540 170" /></svg></div>
            <div className="empty-map"><div className="empty-illustration"><GitBranch size={27} strokeWidth={1.5} /><span className="illustration-spark">✦</span></div><span className="empty-eyebrow">A PLACE FOR YOUR GROWING MIND</span><h2 className="empty-title">아는 것들이 연결되는 곳.</h2><p className="empty-description">궁금한 개념 하나에서 시작해보세요.<br />큰 주제로 묶고, 메모와 링크로 이해를 쌓아보세요.</p><div className="empty-actions"><button className="button primary" onClick={() => setModal('concept')}><Plus size={16} />첫 개념 만들기</button><button className="button secondary" disabled={busy} onClick={loadDemo}>{busy ? <Loader2 size={14} className="spin" /> : <Network size={15} />}예시 지도 둘러보기</button></div><p className="empty-footnote"><span className="status-dot" />나에게만 보이는 비공개 지식 공간</p></div>
            <div className="graph-bottom"><span className="canvas-empty-caption">연결에는 정해진 순서가 없어요.</span><div className="zoom-controls muted"><Focus size={16} /><span className="zoom-value">100%</span></div></div>
          </>}</>}
        </section>
        <ResizeHandle {...panels.handle('right')}/>
        {agentOpen ? <AgentChat api={request} onClose={()=>setAgentOpen(false)} onGraphChanged={()=>refresh(true).then(()=>setGraphReset(n=>n+1)).catch(()=>{})} onUnauthorized={()=>refresh().catch(()=>{})} onConcept={id=>{setGraphReset(n=>n+1);setView('main');setCategory(null);setQuery('');select(id||null);setAgentOpen(false);}}/> : <Details removeTerm={term=>{setEditing(term);setModal('delete-term');}} removeEntry={entry=>{setEditing(entry);setModal('delete-entry');}} highlightEntry={async entry=>{try{await request(`/entries/${entry.id}`,{method:'PATCH',body:JSON.stringify({highlighted:!entry.highlighted})});await refresh(true);}catch(e){notify(e.message);}}} highlightTerm={async term=>{try{const stored=!term.id.startsWith('summary:');await request(`/concepts/${selected.id}/terms${stored?'/'+term.id:''}`,{method:stored?'PATCH':'POST',body:JSON.stringify({term:term.term,definition:term.definition,aliases:term.aliases,highlighted:!term.highlighted})});await refresh(true);}catch(e){notify(e.message);}}} editConcept={()=>{setEditing(selected);setModal('edit-concept');}} editTerm={term=>{setEditing(term);setModal('edit-term');}} editEntry={entry=>{setEditing(entry);setModal('edit-entry');}} termFocus={termFocus} addTerm={()=>setModal('term')} concept={selected} data={data} select={select} addEntry={() => setModal('entry')} connect={() => setModal('relation')} close={() => select(null)} busy={busy} summarize={async id => { try { await save(`/concepts/${encodeURIComponent(id)}/summarize`, {}, '요약 작업을 등록했어요. Codex 작업자가 연결되면 갱신됩니다.'); } catch (e) { notify(e.message); } }} />}
      </div>
    </main>
    {modal === 'delete-entry' && editing && <Modal title="기록을 삭제할까요?" subtitle={editing.title||'제목 없는 기록'} close={()=>setModal(null)}><p className="delete-explanation">이 기록은 연결된 {(editing.concept_ids||[]).length}개 개념에서 모두 삭제돼요. 남은 기록을 기준으로 요약을 다시 정리합니다.</p><div className="form-actions"><button className="button secondary" onClick={()=>setModal(null)} disabled={busy}>취소</button><button className="button danger-button" disabled={busy} onClick={async()=>{try{await save(`/entries/${editing.id}`,undefined,'기록을 삭제했어요.','DELETE');}catch(e){notify(e.message);}}}><Trash2 size={14}/>기록 삭제</button></div></Modal>}
    {modal === 'delete-term' && editing && selected && <Modal title="용어를 삭제할까요?" subtitle={editing.term} close={()=>setModal(null)}><p className="delete-explanation">이 노드의 용어 목록과 검색 결과에서 제외돼요. 자동 요약이 다시 생성돼도 이 용어는 숨김 상태를 유지합니다.</p><div className="form-actions"><button className="button secondary" onClick={()=>setModal(null)} disabled={busy}>취소</button><button className="button danger-button" disabled={busy} onClick={async()=>{try{const stored=!editing.id.startsWith('summary:');await save(`/concepts/${selected.id}/terms${stored?'/'+editing.id:''}`,stored?undefined:{term:editing.term,definition:editing.definition,aliases:editing.aliases,hidden:true},'용어를 삭제했어요.',stored?'DELETE':'POST');}catch(e){notify(e.message);}}}><Trash2 size={14}/>용어 삭제</button></div></Modal>}
    {modal === 'github' && <GithubLogin link onClose={()=>setModal(null)} onSuccess={()=>{setModal(null);refresh().catch(()=>{});notify('GitHub 계정을 연결했어요. 다음부터 GitHub로 로그인할 수 있어요.');}}/>}
    {modal === 'edit-concept' && editing && <ConceptForm initial={editing} categories={categories} close={()=>setModal(null)} busy={busy} onSave={form=>save(`/concepts/${editing.id}`,form,'개념을 수정했어요.','PATCH')}/>}
    {modal === 'edit-entry' && editing && <EntryForm initial={editing} concepts={data.concepts} close={()=>setModal(null)} busy={busy} onSave={form=>save(`/entries/${editing.id}`,form,'기록을 수정했어요. 요약도 다시 정리됩니다.','PATCH')}/>}
    {modal === 'edit-term' && editing && selected && <TermForm initial={editing} concept={selected} close={()=>setModal(null)} busy={busy} onSave={async form=>{const stored=!editing.id.startsWith('summary:');if(!stored&&normalizeName(form.term)!==normalizeName(editing.term))form.aliases=[...new Set([...form.aliases,editing.term])];const term=await save(`/concepts/${selected.id}/terms${stored?'/'+editing.id:''}`,form,'용어를 수정했어요.',stored?'PATCH':'POST');setTermFocus({concept_id:selected.id,term_id:term.id,nonce:crypto.randomUUID()});}}/>}
    {modal === 'term' && selected && <TermForm close={()=>setModal(null)} busy={busy} concept={selected} onSave={async form=>{const term=await save(`/concepts/${selected.id}/terms`,form,'용어를 저장했어요.');setTermFocus({concept_id:selected.id,term_id:term.id,nonce:crypto.randomUUID()});}}/>}
    {modal === 'concept' && <ConceptForm categories={categories} close={() => setModal(null)} busy={busy} onSave={async form => { const result = await save('/concepts', form, '새 개념을 지도에 추가했어요.'); const concept = result.concept || result; if (concept.id) { setView('topic'); setCategory(concept.category || form.category); setSelectedId(concept.id); window.history.pushState(null, '', `#concept/${encodeURIComponent(concept.id)}`); } }} />}
    {modal === 'entry' && <EntryForm concepts={data.concepts} selectedId={selected?.id} close={() => setModal(null)} busy={busy} onSave={async form => { await save('/entries', form, '기록을 저장했어요. Codex 작업자가 연결되면 요약에 반영됩니다.'); if (!selected) openRecent(form.concept_ids[0]); }} />}
    {modal === 'relation' && selected && <RelationForm concept={selected} concepts={data.concepts} close={() => setModal(null)} busy={busy} onSave={form => save('/relations', form, '새로운 연결이 생겼어요.')} />}
    {modal === 'api' && <ApiGuide close={() => setModal(null)} notify={notify} />}
    {toast && <div className="toast" role="status"><Check className="toast-icon" size={16} /><span>{toast}</span><button className="icon-button" onClick={() => setToast('')} aria-label="알림 닫기"><X size={13} /></button></div>}
  </div>;
}
