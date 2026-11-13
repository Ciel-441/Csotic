import React, { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { BrainGraphData, BrainNode } from "../../types/ipc";
import { brain } from "../../services/ipc";
import {
  Search,
  ZoomIn,
  ZoomOut,
  Maximize2,
  RefreshCw,
  FileText,
  Code2,
  Settings,
  Sparkles,
  Camera,
  Sliders,
  ExternalLink,
  Layers,
} from "lucide-react";

interface BrainGraphViewProps {
  projectPath: string;
  projectName?: string;
  onOpenNode?: (path: string) => void;
  activeFilePath?: string | null;
  theme?: "dark" | "light";
}

interface SimNode extends BrainNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: string;
  strokeColor: string;
  glowColor: string;
  pinned?: boolean;
}

export const BrainGraphView: React.FC<BrainGraphViewProps> = ({
  projectPath,
  projectName = "Project",
  onOpenNode,
  activeFilePath,
  theme = "dark",
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [graphData, setGraphData] = useState<BrainGraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  
  // Filter chips
  const [showNotes, setShowNotes] = useState(true);
  const [showCode, setShowCode] = useState(true);
  const [showConfig, setShowConfig] = useState(true);
  const [hideOrphans, setHideOrphans] = useState(false);

  // Display Settings
  const [labelMode, setLabelMode] = useState<"hover" | "hubs" | "all">("hover");
  const [showSettings, setShowSettings] = useState(false);
  const [repulsionStrength, setRepulsionStrength] = useState(3400);
  const [linkDistance, setLinkDistance] = useState(170);
  const [centerForce, setCenterForce] = useState(0.0003);

  // Hover & selection state
  const [hoveredNode, setHoveredNode] = useState<SimNode | null>(null);
  const [selectedNode, setSelectedNode] = useState<SimNode | null>(null);

  // Camera transform (pan & zoom)
  const cameraRef = useRef<{ x: number; y: number; zoom: number }>({ x: 0, y: 0, zoom: 0.65 });

  // Physics simulation state: Simulated Annealing (Alpha Cooling)
  const simNodesRef = useRef<SimNode[]>([]);
  const isDraggingNodeRef = useRef<SimNode | null>(null);
  const isPanningRef = useRef(false);
  const dragStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const animFrameIdRef = useRef<number | null>(null);
  const alphaRef = useRef<number>(1.0);

  // Re-heat simulation smoothly on user interaction
  const reheat = useCallback((amount = 0.4) => {
    alphaRef.current = Math.max(alphaRef.current, amount);
  }, []);

  // Forge Red & Black Signature Palette
  const getPaletteColor = useCallback((node: BrainNode) => {
    if (node.kind === "note") {
      return { fill: "#ef4444", stroke: "#f87171", glow: "rgba(239, 68, 68, 0.65)" };
    }
    if (node.group.includes("components") || node.group.includes("ui") || node.group.includes("layouts")) {
      return { fill: "#f97316", stroke: "#fb923c", glow: "rgba(249, 115, 22, 0.55)" };
    }
    if (node.group.includes("services") || node.group.includes("backend") || node.group.includes("ipc")) {
      return { fill: "#dc2626", stroke: "#ef4444", glow: "rgba(220, 38, 38, 0.65)" };
    }
    if (node.kind === "code") {
      return { fill: "#e11d48", stroke: "#fb7185", glow: "rgba(225, 29, 72, 0.55)" };
    }
    if (node.kind === "config") {
      return { fill: "#f59e0b", stroke: "#fbbf24", glow: "rgba(245, 158, 11, 0.55)" };
    }
    return { fill: "#64748b", stroke: "#94a3b8", glow: "rgba(100, 116, 139, 0.45)" };
  }, []);

  // Fetch graph data from backend
  const fetchGraph = useCallback(async () => {
    if (!projectPath) return;
    setLoading(true);
    try {
      const res = await brain.getGraph(projectPath);
      if (res.success && res.data) {
        const data = res.data as BrainGraphData;
        setGraphData(data);
        initSimulation(data.nodes);
      }
    } catch (e) {
      console.error("Failed to load brain graph:", e);
    } finally {
      setLoading(false);
    }
  }, [projectPath]);

  useEffect(() => {
    fetchGraph();
  }, [fetchGraph]);

  // Cluster nodes naturally in an even 2D radial distribution (Phyllotaxis / Fermat's Spiral)
  const initSimulation = (rawNodes: BrainNode[]) => {
    const goldenAngle = Math.PI * (3 - Math.sqrt(5)); // ~2.39996 rad (137.5 deg)

    simNodesRef.current = rawNodes.map((n, i) => {
      // Uniform 2D spiral distribution across all 360 degrees
      const radius = n.kind === "note" ? 60 + Math.sqrt(i + 1) * 35 : 120 + Math.sqrt(i + 1) * 65;
      const angle = i * goldenAngle;

      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;

      let baseRadius = 7;
      if (n.kind === "note") baseRadius = 12;
      if (n.connections > 1) baseRadius += Math.min(8, n.connections * 0.8);

      const colors = getPaletteColor(n);

      return {
        ...n,
        x,
        y,
        vx: (Math.random() - 0.5) * 3,
        vy: (Math.random() - 0.5) * 3,
        radius: baseRadius,
        color: colors.fill,
        strokeColor: colors.stroke,
        glowColor: colors.glow,
      };
    });

    alphaRef.current = 1.0;
  };

  // Filter visible nodes based on chips, search, and orphan toggle
  const visibleNodes = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return simNodesRef.current.filter((n) => {
      if (hideOrphans && n.connections === 0 && n.kind !== "note") return false;
      if (!showNotes && n.kind === "note") return false;
      if (!showCode && n.kind === "code") return false;
      if (!showConfig && (n.kind === "config" || n.kind === "doc")) return false;
      if (query && !n.label.toLowerCase().includes(query) && !n.id.toLowerCase().includes(query)) {
        return false;
      }
      return true;
    });
  }, [searchQuery, showNotes, showCode, showConfig, hideOrphans, graphData]);

  // Set of connected neighbor node IDs for hovered node
  const neighborNodeIds = useMemo(() => {
    const activeTarget = hoveredNode || selectedNode;
    if (!activeTarget || !graphData) return new Set<string>();
    const set = new Set<string>([activeTarget.id]);
    for (const edge of graphData.edges) {
      if (edge.source === activeTarget.id) set.add(edge.target);
      if (edge.target === activeTarget.id) set.add(edge.source);
    }
    return set;
  }, [hoveredNode, selectedNode, graphData]);

  // Main Canvas Render & Simulated Annealing Physics Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let isRunning = true;

    const render = () => {
      if (!isRunning) return;

      const dpr = window.devicePixelRatio || 1;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;

      if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
        canvas.width = width * dpr;
        canvas.height = height * dpr;
      }

      ctx.save();
      ctx.scale(dpr, dpr);

      // Deep Onyx Black & Charcoal Ambient Background
      const isDark = theme === "dark";
      if (isDark) {
        const bgGrad = ctx.createRadialGradient(width / 2, height / 2, 60, width / 2, height / 2, Math.max(width, height));
        bgGrad.addColorStop(0, "#10090c");
        bgGrad.addColorStop(1, "#040507");
        ctx.fillStyle = bgGrad;
      } else {
        const bgGrad = ctx.createRadialGradient(width / 2, height / 2, 60, width / 2, height / 2, Math.max(width, height));
        bgGrad.addColorStop(0, "#ffffff");
        bgGrad.addColorStop(1, "#f8fafc");
        ctx.fillStyle = bgGrad;
      }
      ctx.fillRect(0, 0, width, height);

      // Sleek Grid Matrix Dots
      ctx.fillStyle = isDark ? "rgba(239, 68, 68, 0.04)" : "rgba(0, 0, 0, 0.04)";
      const gridSize = 36 * cameraRef.current.zoom;
      const offsetX = (cameraRef.current.x * cameraRef.current.zoom + width / 2) % gridSize;
      const offsetY = (cameraRef.current.y * cameraRef.current.zoom + height / 2) % gridSize;

      for (let x = offsetX; x < width; x += gridSize) {
        for (let y = offsetY; y < height; y += gridSize) {
          ctx.beginPath();
          ctx.arc(x, y, 0.9, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Apply camera transformation
      ctx.translate(width / 2 + cameraRef.current.x, height / 2 + cameraRef.current.y);
      ctx.scale(cameraRef.current.zoom, cameraRef.current.zoom);

      // --- Physics Step with Alpha Cooling ---
      const alpha = alphaRef.current;
      const nodes = simNodesRef.current;
      const edges = graphData?.edges || [];
      const visibleSet = new Set(visibleNodes.map((n) => n.id));

      if (alpha > 0.002) {
        const repulsion = repulsionStrength;
        const desiredBaseDist = linkDistance;

        // 1. Repulsion & Soft Elastic Collision across all 2D pairs
        for (let i = 0; i < nodes.length; i++) {
          const n1 = nodes[i];
          if (!visibleSet.has(n1.id)) continue;

          for (let j = i + 1; j < nodes.length; j++) {
            const n2 = nodes[j];
            if (!visibleSet.has(n2.id)) continue;

            let dx = n2.x - n1.x;
            let dy = n2.y - n1.y;
            if (Math.abs(dx) < 0.1 && Math.abs(dy) < 0.1) {
              dx = (Math.random() - 0.5) * 4;
              dy = (Math.random() - 0.5) * 4;
            }
            const distSq = dx * dx + dy * dy + 16;
            const dist = Math.sqrt(distSq);

            const minDist = n1.radius + n2.radius + 36;

            if (dist < minDist) {
              const push = ((minDist - dist) / minDist) * 28 * alpha;
              const fx = (dx / dist) * push;
              const fy = (dy / dist) * push;
              if (!n1.pinned) { n1.vx -= fx; n1.vy -= fy; }
              if (!n2.pinned) { n2.vx += fx; n2.vy += fy; }
            } else {
              const force = (repulsion / (distSq + 200)) * alpha;
              const fx = (dx / dist) * force;
              const fy = (dy / dist) * force;
              if (!n1.pinned) { n1.vx -= fx; n1.vy -= fy; }
              if (!n2.pinned) { n2.vx += fx; n2.vy += fy; }
            }
          }

          // Gentle Isotropic Centering Gravity
          if (!n1.pinned) {
            n1.vx -= n1.x * (centerForce * 0.5) * alpha;
            n1.vy -= n1.y * (centerForce * 0.5) * alpha;
          }
        }

        // 2. Degree-Normalized Spring Attraction along edges
        const nodeMap = new Map(nodes.map((n) => [n.id, n]));
        for (const edge of edges) {
          const source = nodeMap.get(edge.source);
          const target = nodeMap.get(edge.target);

          if (source && target && visibleSet.has(source.id) && visibleSet.has(target.id)) {
            let dx = target.x - source.x;
            let dy = target.y - source.y;
            if (Math.abs(dx) < 0.1 && Math.abs(dy) < 0.1) {
              dx = (Math.random() - 0.5) * 2;
              dy = (Math.random() - 0.5) * 2;
            }
            const dist = Math.sqrt(dx * dx + dy * dy) || 1;
            const desiredDist = edge.relationship === "wikilink" ? desiredBaseDist * 0.85 : desiredBaseDist;
            
            // Normalize spring force by node degree so hub nodes don't crush graphs into 1D clusters
            const sourceDegree = Math.max(1, source.connections);
            const targetDegree = Math.max(1, target.connections);
            const normFactor = 1.0 / Math.sqrt(sourceDegree + targetDegree);

            const force = (dist - desiredDist) * 0.024 * normFactor * alpha;

            const fx = (dx / dist) * force;
            const fy = (dy / dist) * force;

            const bias = sourceDegree / (sourceDegree + targetDegree);
            if (!source.pinned) { source.vx += fx * (1 - bias); source.vy += fy * (1 - bias); }
            if (!target.pinned) { target.vx -= fx * bias; target.vy -= bias * fy; }
          }
        }

        // 3. Update positions with smooth damping
        const friction = 0.76;
        for (const node of nodes) {
          if (!node.pinned) {
            node.vx *= friction;
            node.vy *= friction;

            const speed = Math.sqrt(node.vx * node.vx + node.vy * node.vy);
            if (speed > 12) {
              node.vx = (node.vx / speed) * 12;
              node.vy = (node.vy / speed) * 12;
            }

            node.x += node.vx;
            node.y += node.vy;
          }
        }

        alphaRef.current *= 0.985;
      }

      // --- Draw Edges ---
      const nodeMap = new Map(nodes.map((n) => [n.id, n]));
      for (const edge of edges) {
        const source = nodeMap.get(edge.source);
        const target = nodeMap.get(edge.target);

        if (source && target && visibleSet.has(source.id) && visibleSet.has(target.id)) {
          const isFocused = hoveredNode || selectedNode;
          const isConnectedToActive =
            isFocused && (isFocused.id === source.id || isFocused.id === target.id);
          const isWikilink = edge.relationship === "wikilink";
          const isDimmed = isFocused && !isConnectedToActive;

          ctx.beginPath();
          ctx.moveTo(source.x, source.y);
          ctx.lineTo(target.x, target.y);

          if (isConnectedToActive) {
            ctx.strokeStyle = isWikilink ? "rgba(239, 68, 68, 0.95)" : "rgba(249, 115, 22, 0.95)";
            ctx.lineWidth = 2.4;
          } else if (isDimmed) {
            ctx.strokeStyle = isDark ? "rgba(255, 255, 255, 0.02)" : "rgba(0, 0, 0, 0.02)";
            ctx.lineWidth = 0.5;
          } else {
            ctx.strokeStyle = isDark
              ? isWikilink
                ? "rgba(239, 68, 68, 0.35)"
                : "rgba(255, 255, 255, 0.1)"
              : isWikilink
              ? "rgba(239, 68, 68, 0.4)"
              : "rgba(0, 0, 0, 0.1)";
            ctx.lineWidth = 0.8;
          }

          if (isWikilink) {
            ctx.setLineDash([4, 4]);
          } else {
            ctx.setLineDash([]);
          }
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }

      // --- Draw Nodes ---
      for (const node of visibleNodes) {
        const isHovered = hoveredNode?.id === node.id;
        const isSelected = selectedNode?.id === node.id;
        const isNeighbor = neighborNodeIds.has(node.id);
        const isActiveDoc = activeFilePath && node.path === activeFilePath;
        const isFocused = hoveredNode || selectedNode;
        const isDimmed = isFocused && !isHovered && !isSelected && !isNeighbor;

        const r = node.radius * (isHovered || isSelected ? 1.4 : 1.0);

        ctx.save();
        if (isDimmed) {
          ctx.globalAlpha = 0.15;
        }

        // Multi-layered Glowing halo
        if (isHovered || isSelected || isActiveDoc || node.kind === "note") {
          ctx.beginPath();
          ctx.arc(node.x, node.y, r + 8, 0, Math.PI * 2);
          ctx.fillStyle = node.glowColor;
          ctx.fill();
        }

        // Main Node Body (Gradient Fill)
        const nodeGrad = ctx.createRadialGradient(node.x - r * 0.3, node.y - r * 0.3, r * 0.1, node.x, node.y, r);
        nodeGrad.addColorStop(0, "#ffffff");
        nodeGrad.addColorStop(0.35, node.color);
        nodeGrad.addColorStop(1, node.strokeColor);

        ctx.beginPath();
        ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
        ctx.fillStyle = nodeGrad;
        ctx.fill();

        ctx.strokeStyle = isHovered || isSelected ? "#ffffff" : node.strokeColor;
        ctx.lineWidth = isHovered || isSelected ? 2.2 : 1.2;
        ctx.stroke();

        ctx.restore();
      }

      // --- Draw Node Labels (Sleek Onyx Glassmorphic Pill Tags) ---
      for (const node of visibleNodes) {
        const isHovered = hoveredNode?.id === node.id;
        const isSelected = selectedNode?.id === node.id;
        const isNeighbor = neighborNodeIds.has(node.id);
        const isFocused = hoveredNode || selectedNode;
        const isDimmed = isFocused && !isHovered && !isSelected && !isNeighbor;

        let shouldShowLabel = false;
        if (isHovered || isSelected || isNeighbor) {
          shouldShowLabel = true;
        } else if (isFocused) {
          shouldShowLabel = false;
        } else if (labelMode === "hubs") {
          shouldShowLabel = node.kind === "note" || node.connections >= 8 || cameraRef.current.zoom >= 1.5;
        } else if (labelMode === "all") {
          shouldShowLabel = cameraRef.current.zoom >= 1.0;
        }

        if (shouldShowLabel && !isDimmed) {
          const isNote = node.kind === "note";
          const labelText = node.label;

          ctx.save();
          ctx.font = `${isHovered || isSelected ? "600 " : isNote ? "600 " : "500 "}11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
          const textWidth = ctx.measureText(labelText).width;

          // Glassmorphic pill bounding box
          const pillX = node.x - textWidth / 2 - 8;
          const pillY = node.y + node.radius + 7;
          const pillW = textWidth + 16;
          const pillH = 20;

          // Pill Background
          ctx.fillStyle = isDark
            ? isHovered || isSelected
              ? "rgba(18, 12, 14, 0.95)"
              : "rgba(12, 10, 14, 0.85)"
            : isHovered || isSelected
            ? "rgba(255, 255, 255, 0.98)"
            : "rgba(248, 250, 252, 0.9)";

          ctx.beginPath();
          ctx.roundRect(pillX, pillY, pillW, pillH, 5);
          ctx.fill();

          // Border Glow
          ctx.strokeStyle = isHovered || isSelected
            ? node.color
            : isDark
            ? "rgba(239, 68, 68, 0.2)"
            : "rgba(0, 0, 0, 0.1)";
          ctx.lineWidth = isHovered || isSelected ? 1.5 : 0.8;
          ctx.stroke();

          // Label Text
          ctx.fillStyle = isDark
            ? isHovered || isSelected
              ? "#ffffff"
              : isNote
              ? "#fca5a5"
              : "#e2e8f0"
            : isHovered || isSelected
            ? "#000000"
            : isNote
            ? "#dc2626"
            : "#1e293b";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(labelText, node.x, pillY + pillH / 2);
          ctx.restore();
        }
      }

      ctx.restore();
      animFrameIdRef.current = requestAnimationFrame(render);
    };

    render();

    return () => {
      isRunning = false;
      if (animFrameIdRef.current) cancelAnimationFrame(animFrameIdRef.current);
    };
  }, [
    graphData,
    visibleNodes,
    hoveredNode,
    selectedNode,
    neighborNodeIds,
    activeFilePath,
    theme,
    labelMode,
    repulsionStrength,
    linkDistance,
    centerForce,
  ]);

  // Coordinate Conversion (Screen to World)
  const screenToWorld = useCallback((screenX: number, screenY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    const x = (screenX - rect.left - width / 2 - cameraRef.current.x) / cameraRef.current.zoom;
    const y = (screenY - rect.top - height / 2 - cameraRef.current.y) / cameraRef.current.zoom;
    return { x, y };
  }, []);

  // Mouse Handlers
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const world = screenToWorld(e.clientX, e.clientY);
    
    const clicked = visibleNodes.find((n) => {
      const dx = n.x - world.x;
      const dy = n.y - world.y;
      return Math.sqrt(dx * dx + dy * dy) <= n.radius + 6;
    });

    if (clicked) {
      isDraggingNodeRef.current = clicked;
      clicked.pinned = true;
      setSelectedNode(clicked);
      reheat(0.35);
    } else {
      isPanningRef.current = true;
      setSelectedNode(null);
      dragStartRef.current = { x: e.clientX - cameraRef.current.x, y: e.clientY - cameraRef.current.y };
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const world = screenToWorld(e.clientX, e.clientY);

    if (isDraggingNodeRef.current) {
      isDraggingNodeRef.current.x = world.x;
      isDraggingNodeRef.current.y = world.y;
      isDraggingNodeRef.current.vx = 0;
      isDraggingNodeRef.current.vy = 0;
      reheat(0.3);
      return;
    }

    if (isPanningRef.current) {
      cameraRef.current.x = e.clientX - dragStartRef.current.x;
      cameraRef.current.y = e.clientY - dragStartRef.current.y;
      return;
    }

    const hovered = visibleNodes.find((n) => {
      const dx = n.x - world.x;
      const dy = n.y - world.y;
      return Math.sqrt(dx * dx + dy * dy) <= n.radius + 6;
    });

    if (hovered) {
      setHoveredNode(hovered);
      if (canvasRef.current) canvasRef.current.style.cursor = "pointer";
    } else {
      setHoveredNode(null);
      if (canvasRef.current) canvasRef.current.style.cursor = "grab";
    }
  };

  const handleMouseUp = () => {
    if (isDraggingNodeRef.current) {
      isDraggingNodeRef.current.pinned = false;
      isDraggingNodeRef.current = null;
      reheat(0.2);
    }
    isPanningRef.current = false;
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.15 : 0.88;
    cameraRef.current.zoom = Math.max(0.2, Math.min(3.5, cameraRef.current.zoom * zoomFactor));
  };

  const handleDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const world = screenToWorld(e.clientX, e.clientY);
    const clicked = visibleNodes.find((n) => {
      const dx = n.x - world.x;
      const dy = n.y - world.y;
      return Math.sqrt(dx * dx + dy * dy) <= n.radius + 6;
    });

    if (clicked && onOpenNode) {
      onOpenNode(clicked.path);
    }
  };

  const handleZoom = (direction: "in" | "out") => {
    const factor = direction === "in" ? 1.25 : 0.8;
    cameraRef.current.zoom = Math.max(0.2, Math.min(3.5, cameraRef.current.zoom * factor));
  };

  const handleResetCamera = () => {
    cameraRef.current = { x: 0, y: 0, zoom: 0.65 };
  };

  const handleExportPNG = () => {
    if (!canvasRef.current) return;
    const link = document.createElement("a");
    link.download = `${projectName.toLowerCase()}-brain-graph.png`;
    link.href = canvasRef.current.toDataURL("image/png");
    link.click();
  };

  const isDark = theme === "dark";
  const inspectedNode = selectedNode || hoveredNode;

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        position: "relative",
        overflow: "hidden",
        background: isDark ? "#06070a" : "#f8fafc",
        userSelect: "none",
      }}
    >
      {/* Top Floating Glassmorphism Island in Forge Red & Black */}
      <div
        style={{
          position: "absolute",
          top: 16,
          left: 16,
          right: 16,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          zIndex: 10,
          pointerEvents: "none",
        }}
      >
        {/* Left: Search & Filter Segmented Pills */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, pointerEvents: "auto" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              background: isDark ? "#202024" : "#ffffff",
              border: `1px solid ${isDark ? "#2e2e34" : "#e2e8f0"}`,
              borderRadius: 20,
              padding: "6px 14px",
              boxShadow: "0 4px 16px rgba(0, 0, 0, 0.25)",
            }}
          >
            <Search size={13} color="var(--color-text-tertiary)" />
            <input
              type="text"
              placeholder="Search knowledge graph…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                background: "transparent",
                border: "none",
                outline: "none",
                fontSize: "12px",
                color: isDark ? "#f8fafc" : "#0f172a",
                width: 170,
              }}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "var(--color-text-tertiary)",
                  cursor: "pointer",
                  fontSize: "13px",
                  padding: 0,
                }}
              >
                ×
              </button>
            )}
          </div>

          {/* Filter Chips */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              background: isDark ? "#202024" : "#ffffff",
              border: `1px solid ${isDark ? "#2e2e34" : "#e2e8f0"}`,
              borderRadius: 20,
              padding: "4px 6px",
              boxShadow: "0 4px 16px rgba(0, 0, 0, 0.2)",
            }}
          >
            <button
              onClick={() => { setShowNotes((s) => !s); reheat(0.3); }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                fontSize: "11px",
                fontWeight: 600,
                padding: "3px 10px",
                borderRadius: 12,
                border: "none",
                cursor: "pointer",
                background: showNotes ? "rgba(239, 68, 68, 0.22)" : "transparent",
                color: showNotes ? "#f87171" : "var(--color-text-tertiary)",
                transition: "all 0.15s ease",
              }}
            >
              <FileText size={11} /> Notes
            </button>
            <button
              onClick={() => { setShowCode((s) => !s); reheat(0.3); }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                fontSize: "11px",
                fontWeight: 600,
                padding: "3px 10px",
                borderRadius: 12,
                border: "none",
                cursor: "pointer",
                background: showCode ? "rgba(244, 63, 94, 0.22)" : "transparent",
                color: showCode ? "#fb7185" : "var(--color-text-tertiary)",
                transition: "all 0.15s ease",
              }}
            >
              <Code2 size={11} /> Code
            </button>
            <button
              onClick={() => { setShowConfig((s) => !s); reheat(0.3); }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                fontSize: "11px",
                fontWeight: 600,
                padding: "3px 10px",
                borderRadius: 12,
                border: "none",
                cursor: "pointer",
                background: showConfig ? "rgba(245, 158, 11, 0.22)" : "transparent",
                color: showConfig ? "#fbbf24" : "var(--color-text-tertiary)",
                transition: "all 0.15s ease",
              }}
            >
              <Settings size={11} /> Config
            </button>
          </div>
        </div>

        {/* Right: Stats Counter & Control Buttons */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, pointerEvents: "auto" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              background: isDark ? "#202024" : "#ffffff",
              border: `1px solid ${isDark ? "#2e2e34" : "#e2e8f0"}`,
              borderRadius: 20,
              padding: "5px 12px",
              fontSize: "11px",
              color: "var(--color-text-secondary)",
              fontWeight: 600,
              boxShadow: "0 4px 16px rgba(0, 0, 0, 0.2)",
            }}
          >
            <Sparkles size={12} color="#ef4444" />
            <span>{visibleNodes.length} Nodes</span>
            <span style={{ opacity: 0.3 }}>·</span>
            <span>{graphData?.edges.length || 0} Edges</span>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 2,
              background: isDark ? "#202024" : "#ffffff",
              border: `1px solid ${isDark ? "#2e2e34" : "#e2e8f0"}`,
              borderRadius: 20,
              padding: "3px 5px",
              boxShadow: "0 4px 16px rgba(0, 0, 0, 0.2)",
            }}
          >
            <button
              onClick={() => setShowSettings((s) => !s)}
              title="Graph Physics Settings"
              style={{
                width: 26,
                height: 26,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: showSettings ? "rgba(239, 68, 68, 0.25)" : "transparent",
                border: "none",
                borderRadius: 13,
                color: showSettings ? "#f87171" : isDark ? "#94a3b8" : "#64748b",
                cursor: "pointer",
              }}
            >
              <Sliders size={13} />
            </button>
            <button
              onClick={() => handleZoom("in")}
              title="Zoom In"
              style={{
                width: 26,
                height: 26,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "transparent",
                border: "none",
                borderRadius: 13,
                color: isDark ? "#94a3b8" : "#64748b",
                cursor: "pointer",
              }}
            >
              <ZoomIn size={13} />
            </button>
            <button
              onClick={() => handleZoom("out")}
              title="Zoom Out"
              style={{
                width: 26,
                height: 26,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "transparent",
                border: "none",
                borderRadius: 13,
                color: isDark ? "#94a3b8" : "#64748b",
                cursor: "pointer",
              }}
            >
              <ZoomOut size={13} />
            </button>
            <button
              onClick={handleResetCamera}
              title="Center View"
              style={{
                width: 26,
                height: 26,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "transparent",
                border: "none",
                borderRadius: 13,
                color: isDark ? "#94a3b8" : "#64748b",
                cursor: "pointer",
              }}
            >
              <Maximize2 size={13} />
            </button>
            <button
              onClick={() => { fetchGraph(); reheat(1.0); }}
              title="Re-simulate"
              style={{
                width: 26,
                height: 26,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "transparent",
                border: "none",
                borderRadius: 13,
                color: isDark ? "#94a3b8" : "#64748b",
                cursor: "pointer",
              }}
            >
              <RefreshCw size={13} className={loading ? "spin" : ""} />
            </button>
            <button
              onClick={handleExportPNG}
              title="Export Snapshot"
              style={{
                width: 26,
                height: 26,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "transparent",
                border: "none",
                borderRadius: 13,
                color: isDark ? "#94a3b8" : "#64748b",
                cursor: "pointer",
              }}
            >
              <Camera size={13} />
            </button>
          </div>
        </div>
      </div>

      {/* Floating Obsidian Graph Settings Modal */}
      {showSettings && (
        <div
          style={{
            position: "absolute",
            top: 64,
            right: 16,
            width: 270,
            background: isDark ? "#202024" : "#ffffff",
            border: `1px solid ${isDark ? "#2e2e34" : "#e2e8f0"}`,
            borderRadius: 14,
            padding: "14px 16px",
            zIndex: 20,
            boxShadow: "0 12px 32px rgba(0, 0, 0, 0.4)",
            display: "flex",
            flexDirection: "column",
            gap: 12,
            fontSize: "11.5px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: `1px solid ${isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)"}`, paddingBottom: 6 }}>
            <span style={{ fontWeight: 600, color: isDark ? "#f8fafc" : "#0f172a" }}>Display & Forces</span>
            <button
              onClick={() => setShowSettings(false)}
              style={{ background: "transparent", border: "none", color: "var(--color-text-tertiary)", cursor: "pointer", fontSize: "14px" }}
            >
              ×
            </button>
          </div>

          {/* Label Display Mode */}
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <span style={{ color: "var(--color-text-secondary)", fontWeight: 500 }}>Labels</span>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4 }}>
              {(["hover", "hubs", "all"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setLabelMode(m)}
                  style={{
                    padding: "4px 0",
                    fontSize: "10.5px",
                    fontWeight: labelMode === m ? 600 : 400,
                    borderRadius: 6,
                    border: `1px solid ${labelMode === m ? "#ef4444" : isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)"}`,
                    background: labelMode === m ? "rgba(239, 68, 68, 0.2)" : "transparent",
                    color: labelMode === m ? (isDark ? "#ffffff" : "#dc2626") : "var(--color-text-secondary)",
                    cursor: "pointer",
                    textTransform: "capitalize",
                  }}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>

          {/* Hide Orphans Toggle */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ color: "var(--color-text-secondary)" }}>Hide Unlinked Orphans</span>
            <input
              type="checkbox"
              checked={hideOrphans}
              onChange={(e) => { setHideOrphans(e.target.checked); reheat(0.3); }}
              style={{ cursor: "pointer", accentColor: "#ef4444" }}
            />
          </div>

          {/* Repulsion Slider */}
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ display: "flex", justifyContent: "space-between", color: "var(--color-text-secondary)" }}>
              <span>Node Repulsion</span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: "10px" }}>{repulsionStrength}</span>
            </div>
            <input
              type="range"
              min="800"
              max="5000"
              step="100"
              value={repulsionStrength}
              onChange={(e) => { setRepulsionStrength(Number(e.target.value)); reheat(0.4); }}
              style={{ cursor: "pointer", accentColor: "#ef4444" }}
            />
          </div>

          {/* Link Distance Slider */}
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ display: "flex", justifyContent: "space-between", color: "var(--color-text-secondary)" }}>
              <span>Link Distance</span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: "10px" }}>{linkDistance}px</span>
            </div>
            <input
              type="range"
              min="80"
              max="280"
              step="10"
              value={linkDistance}
              onChange={(e) => { setLinkDistance(Number(e.target.value)); reheat(0.4); }}
              style={{ cursor: "pointer", accentColor: "#ef4444" }}
            />
          </div>

          {/* Center Gravity Slider */}
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ display: "flex", justifyContent: "space-between", color: "var(--color-text-secondary)" }}>
              <span>Center Gravity</span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: "10px" }}>{(centerForce * 10000).toFixed(1)}</span>
            </div>
            <input
              type="range"
              min="0.0001"
              max="0.001"
              step="0.0001"
              value={centerForce}
              onChange={(e) => { setCenterForce(Number(e.target.value)); reheat(0.4); }}
              style={{ cursor: "pointer", accentColor: "#ef4444" }}
            />
          </div>
        </div>
      )}

      {/* Main Canvas */}
      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onWheel={handleWheel}
        onDoubleClick={handleDoubleClick}
        style={{ width: "100%", height: "100%", display: "block", cursor: "grab" }}
      />

      {/* Bottom Left Sleek Node Details Card in Forge Red & Black */}
      {inspectedNode && (
        <div
          style={{
            position: "absolute",
            bottom: 16,
            left: 16,
            background: isDark ? "#202024" : "#ffffff",
            border: `1px solid ${
              inspectedNode.kind === "note"
                ? "rgba(239, 68, 68, 0.45)"
                : isDark
                ? "#2e2e34"
                : "#e2e8f0"
            }`,
            borderRadius: 12,
            padding: "12px 16px",
            zIndex: 10,
            boxShadow: "0 12px 32px rgba(0, 0, 0, 0.35)",
            maxWidth: 320,
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: inspectedNode.color,
                  boxShadow: `0 0 10px ${inspectedNode.glowColor}`,
                }}
              />
              <span style={{ fontSize: "12.5px", fontWeight: 600, color: isDark ? "#ffffff" : "#0f172a" }}>
                {inspectedNode.label}
              </span>
            </div>
            {onOpenNode && (
              <button
                onClick={() => onOpenNode(inspectedNode.path)}
                title="Open in Editor"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 3,
                  fontSize: "10.5px",
                  fontWeight: 600,
                  color: "#ef4444",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  padding: 0,
                }}
              >
                Open <ExternalLink size={11} />
              </button>
            )}
          </div>

          <div style={{ fontSize: "10.5px", color: "var(--color-text-tertiary)", wordBreak: "break-all" }}>
            {inspectedNode.id}
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              fontSize: "10px",
              color: "var(--color-text-secondary)",
              borderTop: `1px solid ${isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.08)"}`,
              paddingTop: 6,
              marginTop: 2,
            }}
          >
            <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <Layers size={11} /> {inspectedNode.group}
            </span>
            <span style={{ fontWeight: 600, color: inspectedNode.connections > 0 ? "#ef4444" : "inherit" }}>
              {inspectedNode.connections} Link{inspectedNode.connections !== 1 ? "s" : ""}
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
