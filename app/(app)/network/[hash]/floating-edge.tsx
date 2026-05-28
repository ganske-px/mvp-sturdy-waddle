'use client';

import { useCallback, useMemo } from 'react';
import { type EdgeProps, type Node, Position, getBezierPath, useStore } from 'reactflow';
import { useEdgeHoverState } from './hover-store';

// Floating edges. Default React Flow edges connect to fixed Handle positions
// (Top/Bottom on our nodes), so when 300 edges all start at the centre node's
// "bottom" Handle they fan out from a single point — a visually thick bundle
// regardless of where the targets actually are. Floating edges derive each
// endpoint from the geometry of the source/target nodes, picking the point
// on each node's bounding box closest to the line that joins their centres.
//
// Adapted from the React Flow v11 floating-edges example.

type RFNode = Node & {
  width?: number | null;
  height?: number | null;
  positionAbsolute?: { x: number; y: number };
};

function getNodeIntersection(intersectionNode: RFNode, targetNode: RFNode) {
  const iw = intersectionNode.width ?? 80;
  const ih = intersectionNode.height ?? 26;
  const tw = targetNode.width ?? 80;
  const th = targetNode.height ?? 26;
  const ipos = intersectionNode.positionAbsolute ?? intersectionNode.position;
  const tpos = targetNode.positionAbsolute ?? targetNode.position;

  const x2 = ipos.x + iw / 2;
  const y2 = ipos.y + ih / 2;
  const x1 = tpos.x + tw / 2;
  const y1 = tpos.y + th / 2;

  const w = iw / 2;
  const h = ih / 2;
  const xx1 = (x1 - x2) / (2 * w) - (y1 - y2) / (2 * h);
  const yy1 = (x1 - x2) / (2 * w) + (y1 - y2) / (2 * h);
  const a = 1 / (Math.abs(xx1) + Math.abs(yy1) || 1);
  const xx3 = a * xx1;
  const yy3 = a * yy1;
  return { x: x2 + w * xx3, y: y2 + h * yy3 };
}

function getEdgePosition(node: RFNode, intersection: { x: number; y: number }): Position {
  const npos = node.positionAbsolute ?? node.position;
  const nx = Math.round(npos.x);
  const ny = Math.round(npos.y);
  const px = Math.round(intersection.x);
  const py = Math.round(intersection.y);
  if (px <= nx + 1) return Position.Left;
  if (px >= nx + (node.width ?? 80) - 1) return Position.Right;
  if (py <= ny + 1) return Position.Top;
  if (py >= ny + (node.height ?? 26) - 1) return Position.Bottom;
  return Position.Top;
}

function getEdgeParams(source: RFNode, target: RFNode) {
  const sp = getNodeIntersection(source, target);
  const tp = getNodeIntersection(target, source);
  return {
    sx: sp.x,
    sy: sp.y,
    tx: tp.x,
    ty: tp.y,
    sourcePos: getEdgePosition(source, sp),
    targetPos: getEdgePosition(target, tp),
  };
}

type FloatingEdgeData = { pathActive?: boolean };

export function FloatingEdge({
  id,
  source,
  target,
  style,
  markerEnd,
  data,
}: EdgeProps<FloatingEdgeData>) {
  const sourceNode = useStore(
    useCallback((store) => store.nodeInternals.get(source) as RFNode | undefined, [source]),
  );
  const targetNode = useStore(
    useCallback((store) => store.nodeInternals.get(target) as RFNode | undefined, [target]),
  );

  // Geometry only depends on the node objects (positions/dimensions). Memoizing
  // on those refs keeps hover restyling from recomputing the bezier path — node
  // refs stay stable across hovers, so this recomputes only on relayout.
  const path = useMemo(() => {
    if (!sourceNode || !targetNode) return null;
    const { sx, sy, tx, ty, sourcePos, targetPos } = getEdgeParams(sourceNode, targetNode);
    return getBezierPath({
      sourceX: sx,
      sourceY: sy,
      sourcePosition: sourcePos,
      targetPosition: targetPos,
      targetX: tx,
      targetY: ty,
    })[0];
  }, [sourceNode, targetNode]);

  const hover = useEdgeHoverState(source, target);

  if (!path) return null;

  // While a shortest-path is highlighted, the path styling baked into `style`
  // wins and hover is ignored (matches node behaviour). Otherwise hover dims
  // non-incident edges and brightens the incident ones.
  const resolvedStyle =
    data?.pathActive || hover === 0 ? style : { ...style, opacity: hover === 1 ? 1 : 0.08 };

  return (
    <path
      id={id}
      className="react-flow__edge-path"
      d={path}
      style={resolvedStyle}
      markerEnd={markerEnd}
      fill="none"
    />
  );
}
