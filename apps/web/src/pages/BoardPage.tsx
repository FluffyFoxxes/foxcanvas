import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps,
} from "@xyflow/react";
import {
  ArrowLeft,
  Bot,
  Box,
  Check,
  ChevronRight,
  Circle,
  Copy,
  Download,
  FileText,
  Loader2,
  MessageSquareText,
  Redo2,
  RotateCcw,
  Sparkles,
  Square,
  StickyNote,
  Trash2,
  Undo2,
  Upload,
  X,
} from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  MAX_CANVAS_LABEL_LENGTH,
  MAX_CANVAS_TEXT_LENGTH,
} from "@foxcanvas/canvas-schema";
import { api, ApiError, type Board } from "../lib/api";
import {
  boardFitViewOptions,
  createAiGraph,
  duplicateNodes,
  guardCanvasDocumentChange,
  parseImportFile,
  type CanvasData,
  type CanvasDocument,
} from "../state/board";
import {
  boardDraftStorageKey,
  createBoardSaveBody,
  findMatchingBoardDraft,
  normalizeBoardTitle,
  serializeBoardDraft,
} from "../state/boardPersistence";
import {
  SaveCoordinator,
  attachSaveLifecycle,
  flushBeforeNavigation,
  type SaveStatus,
} from "../state/saveCoordinator";

type CanvasNode = Node<CanvasData>;
type EditorContextValue = {
  update: (id: string, data: Partial<CanvasData>) => void;
  checkpoint: () => void;
};
const EditorContext = createContext<EditorContextValue>({
  update: () => undefined,
  checkpoint: () => undefined,
});
const colors: Record<string, string> = {
  yellow: "#f8e58c",
  coral: "#f6b29c",
  mint: "#bfe1cb",
  blue: "#b9d8ef",
  purple: "#d8c5ec",
  gray: "#dedbd3",
};

function NodeHandles() {
  return (
    <>
      <Handle type="target" position={Position.Top} />
      <Handle type="source" position={Position.Bottom} />
    </>
  );
}
function StickyNode({ id, data, selected }: NodeProps<CanvasNode>) {
  const editor = useContext(EditorContext);
  return (
    <div
      style={{ background: colors[String(data.color)] || colors.yellow }}
      className={`min-h-40 w-52 rotate-[-1deg] rounded-sm p-5 shadow-[0_10px_25px_rgba(40,35,20,.16)] transition ${selected ? "ring-2 ring-ink ring-offset-2" : ""}`}
    >
      <NodeHandles />
      <textarea
        aria-label="Sticky note"
        maxLength={MAX_CANVAS_TEXT_LENGTH}
        value={String(data.text || "")}
        onFocus={editor.checkpoint}
        onChange={(e) => editor.update(id, { text: e.target.value })}
        placeholder="Write a thought…"
        className="nodrag nowheel h-28 w-full resize-none bg-transparent text-[15px] leading-relaxed outline-none placeholder:text-black/35"
      />
    </div>
  );
}
function TextNode({ id, data, selected }: NodeProps<CanvasNode>) {
  const editor = useContext(EditorContext);
  return (
    <div
      className={`min-w-56 rounded-xl bg-white/90 px-5 py-4 shadow-sm ${selected ? "ring-2 ring-ink" : "border border-stone-200"}`}
    >
      <NodeHandles />
      <textarea
        aria-label="Text"
        maxLength={MAX_CANVAS_TEXT_LENGTH}
        value={String(data.text || "")}
        onFocus={editor.checkpoint}
        onChange={(e) => editor.update(id, { text: e.target.value })}
        className="nodrag nowheel min-h-12 w-full resize-none bg-transparent text-lg font-medium outline-none"
      />
    </div>
  );
}
function ShapeNode({ id, data, selected }: NodeProps<CanvasNode>) {
  const editor = useContext(EditorContext);
  const shape = String(data.shape || "rectangle");
  return (
    <div
      style={{ background: colors[String(data.color)] || colors.blue }}
      className={`grid h-36 w-48 place-items-center p-6 ${shape === "ellipse" ? "rounded-[50%]" : shape === "diamond" ? "rotate-45 rounded-lg" : "rounded-2xl"} ${selected ? "ring-2 ring-ink ring-offset-2" : ""}`}
    >
      <NodeHandles />
      <input
        aria-label="Shape label"
        maxLength={MAX_CANVAS_LABEL_LENGTH}
        value={String(data.label || "")}
        onFocus={editor.checkpoint}
        onChange={(e) => editor.update(id, { label: e.target.value })}
        className={`nodrag w-full bg-transparent text-center font-semibold outline-none ${shape === "diamond" ? "-rotate-45" : ""}`}
        placeholder="Label"
      />
    </div>
  );
}
const nodeTypes = { sticky: StickyNode, text: TextNode, shape: ShapeNode };
type BoardSaveValue = { title: string; document: CanvasDocument };

function BoardEditor() {
  const { boardId = "" } = useParams();
  const navigate = useNavigate();
  const flow = useReactFlow<CanvasNode, Edge>();
  const [board, setBoard] = useState<Board | null>(null);
  const [title, setTitle] = useState("");
  const [nodes, setNodes] = useState<CanvasNode[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [saveState, setSaveState] = useState<SaveStatus>("saved");
  const [error, setError] = useState("");
  const [aiOpen, setAiOpen] = useState(false);
  const [aiInput, setAiInput] = useState("");
  const [aiMode, setAiMode] = useState("brainstorm");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState("");
  const [aiResult, setAiResult] = useState<{
    title: string;
    summary?: string;
    items: Array<{ text: string; color: string }>;
  } | null>(null);
  const [selectedColor, setSelectedColor] = useState("yellow");
  const saveCoordinator = useRef<SaveCoordinator<BoardSaveValue> | null>(null);
  const skipHydratedSnapshot = useRef(false);
  const past = useRef<CanvasDocument[]>([]);
  const future = useRef<CanvasDocument[]>([]);
  const documentRef = useRef<CanvasDocument>({ nodes: [], edges: [] });
  documentRef.current = { nodes, edges };

  useEffect(() => {
    let cancelled = false;
    const previous = saveCoordinator.current;
    if (previous?.isDirty()) void previous.flush({ keepalive: true });
    previous?.dispose();
    saveCoordinator.current = null;
    void api<{ board: Board }>(`/boards/${boardId}`)
      .then(({ board: value }) => {
        if (cancelled) return;
        const initialDocument = value.document as CanvasDocument;
        const draftKey = boardDraftStorageKey(boardId);
        let restoredDraft = null;
        try {
          restoredDraft = findMatchingBoardDraft(
            localStorage.getItem(draftKey),
            value.updatedAt,
          );
        } catch {
          setError(
            "Local draft storage is unavailable. Keep this tab open until your changes are saved.",
          );
        }
        const initialSnapshot: BoardSaveValue = restoredDraft
          ? { title: restoredDraft.title, document: restoredDraft.document }
          : { title: value.title, document: initialDocument };
        let ownedDraft: string | null = null;
        let coordinator: SaveCoordinator<BoardSaveValue>;
        coordinator = new SaveCoordinator<BoardSaveValue>({
          initialValue: { title: value.title, document: initialDocument },
          initialVersion: value.updatedAt,
          debounceMs: 900,
          onStatus: (status) => {
            if (!cancelled && saveCoordinator.current === coordinator)
              setSaveState(status);
            if (status === "saved") {
              try {
                if (
                  ownedDraft !== null &&
                  localStorage.getItem(draftKey) === ownedDraft
                )
                  localStorage.removeItem(draftKey);
              } catch {
                if (!cancelled)
                  setError("The saved local draft could not be cleared.");
              }
            }
          },
          onDirtySnapshot: (snapshot, baseUpdatedAt) => {
            try {
              const serialized = serializeBoardDraft({
                ...snapshot,
                baseUpdatedAt,
              });
              localStorage.setItem(draftKey, serialized);
              ownedDraft = serialized;
            } catch {
              if (!cancelled)
                setError(
                  "Could not store a local draft. Keep this tab open until your changes are saved.",
                );
            }
          },
          statusForError: (saveError) =>
            saveError instanceof ApiError && saveError.status === 409
              ? "conflict"
              : "error",
          save: async (snapshot, updatedAt, options) => {
            const body = createBoardSaveBody(
              snapshot,
              updatedAt,
              options.keepalive,
            );
            const result = await api<{ board: Board }>(`/boards/${boardId}`, {
              method: "PUT",
              keepalive: options.keepalive,
              body,
            });
            if (!cancelled) setBoard(result.board);
            return { updatedAt: result.board.updatedAt };
          },
        });
        saveCoordinator.current = coordinator;
        skipHydratedSnapshot.current = true;
        setSaveState("saved");
        setBoard(value);
        setTitle(initialSnapshot.title);
        setNodes(initialSnapshot.document.nodes as CanvasNode[]);
        setEdges(initialSnapshot.document.edges as Edge[]);
        if (restoredDraft) {
          coordinator.change(initialSnapshot);
          void coordinator.flush({ keepalive: false });
        }
      })
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Could not load board"),
      );
    return () => {
      cancelled = true;
      const coordinator = saveCoordinator.current;
      if (coordinator?.isDirty()) void coordinator.flush({ keepalive: true });
      coordinator?.dispose();
    };
  }, [boardId]);

  const checkpoint = useCallback(() => {
    past.current = [
      ...past.current.slice(-49),
      structuredClone(documentRef.current),
    ];
    future.current = [];
  }, []);
  const commitDocument = useCallback(
    (candidate: CanvasDocument, createCheckpoint = false) => {
      const previous = documentRef.current;
      const guarded = guardCanvasDocumentChange(previous, candidate);
      if (!guarded.accepted) {
        setError(guarded.error);
        return false;
      }
      if (createCheckpoint) {
        past.current = [...past.current.slice(-49), structuredClone(previous)];
        future.current = [];
      }
      documentRef.current = guarded.document;
      setNodes(guarded.document.nodes as CanvasNode[]);
      setEdges(guarded.document.edges);
      return true;
    },
    [],
  );
  const doUndo = useCallback(() => {
    const previous = past.current.at(-1);
    if (!previous) return;
    const current = structuredClone(documentRef.current);
    if (!commitDocument(previous)) return;
    past.current.pop();
    future.current.unshift(current);
  }, [commitDocument]);
  const doRedo = useCallback(() => {
    const next = future.current[0];
    if (!next) return;
    const current = structuredClone(documentRef.current);
    if (!commitDocument(next)) return;
    future.current.shift();
    past.current.push(current);
  }, [commitDocument]);

  useEffect(() => {
    const coordinator = saveCoordinator.current;
    if (!coordinator) return;
    if (skipHydratedSnapshot.current) {
      skipHydratedSnapshot.current = false;
      return;
    }
    coordinator.change({
      title: normalizeBoardTitle(title),
      document: { nodes, edges },
    });
  }, [title, nodes, edges]);

  useEffect(() => {
    const coordinator = saveCoordinator.current;
    if (!coordinator || !board) return;
    return attachSaveLifecycle(window, coordinator);
  }, [board?.id]);

  const onNodesChange = useCallback(
    (changes: NodeChange<CanvasNode>[]) => {
      const current = documentRef.current;
      const nextNodes = applyNodeChanges(
        changes,
        current.nodes as CanvasNode[],
      );
      const nodeIds = new Set(nextNodes.map((node) => node.id));
      const nextEdges = current.edges.filter(
        (edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target),
      );
      commitDocument(
        { nodes: nextNodes, edges: nextEdges },
        changes.some((change) => change.type === "remove"),
      );
    },
    [commitDocument],
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange<Edge>[]) => {
      const current = documentRef.current;
      commitDocument(
        { ...current, edges: applyEdgeChanges(changes, current.edges) },
        changes.some((change) => change.type === "remove"),
      );
    },
    [commitDocument],
  );
  const onConnect = useCallback(
    (connection: Connection) => {
      const current = documentRef.current;
      commitDocument(
        {
          ...current,
          edges: addEdge(
            {
              ...connection,
              markerEnd: { type: MarkerType.ArrowClosed },
              style: { strokeWidth: 2, stroke: "#77736c" },
            },
            current.edges,
          ),
        },
        true,
      );
    },
    [commitDocument],
  );
  const updateNode = useCallback(
    (id: string, data: Partial<CanvasData>) => {
      const current = documentRef.current;
      commitDocument({
        ...current,
        nodes: current.nodes.map((node) =>
          node.id === id ? { ...node, data: { ...node.data, ...data } } : node,
        ),
      });
    },
    [commitDocument],
  );

  const addNode = (
    type: "sticky" | "text" | "shape",
    shape?: CanvasData["shape"],
  ) => {
    const current = documentRef.current;
    const position = flow.screenToFlowPosition({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    });
    const data: CanvasData =
      type === "shape"
        ? { label: "New shape", color: selectedColor, shape }
        : {
            text: type === "sticky" ? "New idea" : "Add a heading",
            color: selectedColor,
          };
    commitDocument(
      {
        ...current,
        nodes: [
          ...current.nodes.map((node) => ({ ...node, selected: false })),
          { id: crypto.randomUUID(), type, position, selected: true, data },
        ],
      },
      true,
    );
  };
  const removeSelected = useCallback(() => {
    const current = documentRef.current;
    if (
      !current.nodes.some((node) => node.selected) &&
      !current.edges.some((edge) => edge.selected)
    )
      return;
    const ids = new Set(
      current.nodes.filter((node) => node.selected).map((node) => node.id),
    );
    commitDocument(
      {
        nodes: current.nodes.filter((node) => !node.selected),
        edges: current.edges.filter(
          (edge) =>
            !edge.selected && !ids.has(edge.source) && !ids.has(edge.target),
        ),
      },
      true,
    );
  }, [commitDocument]);
  const duplicate = useCallback(() => {
    const current = documentRef.current;
    if (!current.nodes.some((node) => node.selected)) return;
    commitDocument({ ...current, nodes: duplicateNodes(current.nodes) }, true);
  }, [commitDocument]);
  const recolor = (color: string) => {
    setSelectedColor(color);
    const current = documentRef.current;
    if (current.nodes.some((node) => node.selected)) {
      commitDocument(
        {
          ...current,
          nodes: current.nodes.map((node) =>
            node.selected ? { ...node, data: { ...node.data, color } } : node,
          ),
        },
        true,
      );
    }
  };

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const editing = ["INPUT", "TEXTAREA", "SELECT"].includes(
        (event.target as HTMLElement).tagName,
      );
      if (editing) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        event.shiftKey ? doRedo() : doUndo();
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "y") {
        event.preventDefault();
        doRedo();
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "d") {
        event.preventDefault();
        duplicate();
      }
      if (event.key === "Delete" || event.key === "Backspace") removeSelected();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [doUndo, doRedo, duplicate, removeSelected]);

  const exportJson = () => {
    const blob = new Blob([JSON.stringify({ nodes, edges }, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${title.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "board"}.foxcanvas.json`;
    link.click();
    URL.revokeObjectURL(url);
  };
  const importJson = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const parsed = await parseImportFile(file);
      if (commitDocument(parsed, true)) setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    }
    event.target.value = "";
  };
  const askAi = async () => {
    if (!aiInput.trim()) return;
    setAiBusy(true);
    setAiError("");
    setAiResult(null);
    try {
      const response = await api<{ result: typeof aiResult }>("/ai", {
        method: "POST",
        body: JSON.stringify({
          mode: aiMode,
          input: aiInput,
          context: { nodes, edges },
        }),
      });
      setAiResult(response.result);
    } catch (e) {
      setAiError(e instanceof Error ? e.message : "AI request failed");
    } finally {
      setAiBusy(false);
    }
  };
  const addAiItems = () => {
    if (!aiResult?.items.length) return;
    const center = flow.screenToFlowPosition({
      x: window.innerWidth * 0.55,
      y: window.innerHeight * 0.45,
    });
    const generated = createAiGraph(aiResult, center);
    const current = documentRef.current;
    if (
      commitDocument(
        {
          nodes: [...current.nodes, ...generated.nodes],
          edges: [...current.edges, ...generated.edges],
        },
        true,
      )
    ) {
      setAiResult(null);
      setAiInput("");
    }
  };
  const leaveBoard = async () => {
    const coordinator = saveCoordinator.current;
    if (!coordinator) {
      navigate("/");
      return;
    }
    const left = await flushBeforeNavigation(coordinator, () => navigate("/"));
    if (!left)
      setError(
        "Your changes are still unsaved. Resolve the save problem before leaving.",
      );
  };

  if (error && !board)
    return (
      <div className="grid h-screen place-items-center bg-cream text-center">
        <div>
          <p className="text-xl font-semibold">{error}</p>
          <Link to="/" className="mt-4 inline-block text-fox underline">
            Back to boards
          </Link>
        </div>
      </div>
    );
  if (!board)
    return (
      <div className="grid h-screen place-items-center bg-cream">
        <Loader2 className="animate-spin text-fox" />
      </div>
    );
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-cream">
      <header className="z-20 flex h-16 shrink-0 items-center gap-3 border-b border-stone-200 bg-white px-4 shadow-sm">
        <button
          onClick={() => void leaveBoard()}
          className="rounded-lg p-2 text-stone-500 hover:bg-stone-100"
          title="All boards"
        >
          <ArrowLeft size={19} />
        </button>
        <span className="h-6 w-px bg-stone-200" />
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => setTitle(normalizeBoardTitle(title))}
          maxLength={120}
          className="min-w-0 max-w-sm flex-1 rounded-lg px-2 py-1 font-semibold outline-none hover:bg-stone-50 focus:bg-stone-100"
          aria-label="Board title"
        />
        <SaveBadge state={saveState} />
        {saveState === "conflict" && (
          <button
            onClick={() => window.location.reload()}
            className="flex items-center gap-1 rounded-lg bg-amber-100 px-3 py-1.5 text-xs font-semibold text-amber-800"
          >
            <RotateCcw size={13} /> Reload latest
          </button>
        )}
        {saveState === "error" && (
          <button
            onClick={() => void saveCoordinator.current?.flush()}
            className="flex items-center gap-1 rounded-lg bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700"
          >
            <RotateCcw size={13} /> Retry save
          </button>
        )}
        <div className="ml-auto flex items-center gap-1">
          <ToolButton title="Undo" onClick={doUndo}>
            <Undo2 size={18} />
          </ToolButton>
          <ToolButton title="Redo" onClick={doRedo}>
            <Redo2 size={18} />
          </ToolButton>
          <span className="mx-1 h-6 w-px bg-stone-200" />
          <ToolButton title="Export JSON" onClick={exportJson}>
            <Download size={18} />
          </ToolButton>
          <label
            className="rounded-lg p-2 text-stone-500 hover:bg-stone-100 hover:text-ink"
            title="Import JSON"
          >
            <Upload size={18} />
            <input
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => void importJson(e)}
            />
          </label>
          <button
            onClick={() => setAiOpen((value) => !value)}
            className={`ml-2 flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold ${aiOpen ? "bg-ink text-white" : "bg-orange-100 text-orange-800 hover:bg-orange-200"}`}
          >
            <Sparkles size={16} /> Ask AI
          </button>
        </div>
      </header>
      <div className="relative flex min-h-0 flex-1">
        <aside className="z-10 flex w-16 shrink-0 flex-col items-center gap-2 border-r border-stone-200 bg-white py-4 shadow-sm">
          <ToolButton title="Sticky note" onClick={() => addNode("sticky")}>
            <StickyNote size={20} />
          </ToolButton>
          <ToolButton title="Text" onClick={() => addNode("text")}>
            <FileText size={20} />
          </ToolButton>
          <ToolButton
            title="Rectangle"
            onClick={() => addNode("shape", "rectangle")}
          >
            <Square size={20} />
          </ToolButton>
          <ToolButton
            title="Ellipse"
            onClick={() => addNode("shape", "ellipse")}
          >
            <Circle size={20} />
          </ToolButton>
          <ToolButton
            title="Diamond"
            onClick={() => addNode("shape", "diamond")}
          >
            <Box size={20} />
          </ToolButton>
          <span className="my-1 h-px w-8 bg-stone-200" />
          <ToolButton title="Duplicate selected (Ctrl+D)" onClick={duplicate}>
            <Copy size={19} />
          </ToolButton>
          <ToolButton title="Delete selected" onClick={removeSelected}>
            <Trash2 size={19} />
          </ToolButton>
          <div className="mt-auto flex flex-col gap-2">
            {Object.entries(colors).map(([name, value]) => (
              <button
                key={name}
                onClick={() => recolor(name)}
                title={`${name} color`}
                style={{ background: value }}
                className={`h-5 w-5 rounded-full border border-black/10 transition hover:scale-110 ${selectedColor === name ? "ring-2 ring-ink ring-offset-2" : ""}`}
              />
            ))}
          </div>
        </aside>
        <main className="min-w-0 flex-1 grid-paper">
          <EditorContext.Provider value={{ update: updateNode, checkpoint }}>
            <ReactFlow<CanvasNode, Edge>
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onNodeDragStart={checkpoint}
              fitView
              fitViewOptions={boardFitViewOptions}
              deleteKeyCode={null}
              defaultEdgeOptions={{
                markerEnd: { type: MarkerType.ArrowClosed },
                style: { stroke: "#77736c", strokeWidth: 2 },
              }}
              minZoom={0.15}
              maxZoom={2.5}
            >
              <Background
                variant={BackgroundVariant.Dots}
                gap={22}
                size={1}
                color="#cac5b8"
              />
              <Controls position="bottom-left" />
              <MiniMap
                position="bottom-right"
                nodeColor={(node) => colors[String(node.data.color)] || "#fff"}
                maskColor="rgba(246,244,238,.75)"
              />
            </ReactFlow>
          </EditorContext.Provider>
        </main>
        <aside
          className={`z-10 shrink-0 overflow-hidden border-l border-stone-200 bg-white shadow-[-8px_0_30px_rgba(30,30,25,.06)] transition-[width] duration-300 ${aiOpen ? "w-[360px]" : "w-0"}`}
        >
          <div className="flex h-full w-[360px] flex-col">
            <div className="flex items-center gap-3 border-b border-stone-200 p-5">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-orange-100 text-fox">
                <Bot size={20} />
              </span>
              <div>
                <h2 className="font-semibold">Canvas assistant</h2>
                <p className="text-xs text-stone-500">
                  Turn prompts into building blocks
                </p>
              </div>
              <button
                onClick={() => setAiOpen(false)}
                className="ml-auto rounded-lg p-2 hover:bg-stone-100"
              >
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5">
              <label className="text-xs font-semibold uppercase tracking-wider text-stone-500">
                Mode
                <select
                  value={aiMode}
                  onChange={(e) => setAiMode(e.target.value)}
                  className="mt-2 w-full rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-sm font-normal normal-case tracking-normal outline-none focus:border-fox"
                >
                  {[
                    "brainstorm",
                    "sticky-notes",
                    "summarize",
                    "cluster",
                    "mind-map",
                    "rewrite",
                  ].map((mode) => (
                    <option key={mode} value={mode}>
                      {mode.replace("-", " ")}
                    </option>
                  ))}
                </select>
              </label>
              <textarea
                value={aiInput}
                onChange={(e) => setAiInput(e.target.value)}
                placeholder="What should we explore?"
                className="mt-4 h-32 w-full resize-none rounded-xl border border-stone-200 p-3 text-sm outline-none focus:border-fox"
              />
              <button
                disabled={aiBusy || !aiInput.trim()}
                onClick={() => void askAi()}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-ink px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
              >
                {aiBusy ? (
                  <Loader2 className="animate-spin" size={16} />
                ) : (
                  <Sparkles size={16} />
                )}{" "}
                Generate
              </button>
              {aiError && (
                <p
                  role="alert"
                  className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm leading-relaxed text-red-800"
                >
                  {aiError}
                </p>
              )}
              {aiResult && (
                <div className="mt-5 animate-pop rounded-2xl border border-orange-100 bg-orange-50 p-4">
                  <h3 className="font-semibold">{aiResult.title}</h3>
                  {aiResult.summary && (
                    <p className="mt-2 text-sm text-stone-600">
                      {aiResult.summary}
                    </p>
                  )}
                  <div className="mt-3 space-y-2">
                    {aiResult.items.map((item, i) => (
                      <div
                        key={i}
                        className="flex gap-2 rounded-lg bg-white p-2 text-sm"
                      >
                        <ChevronRight
                          className="mt-0.5 shrink-0 text-fox"
                          size={14}
                        />
                        {item.text}
                      </div>
                    ))}
                  </div>
                  {aiResult.items.length > 0 && (
                    <button
                      onClick={addAiItems}
                      className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-fox px-3 py-2 text-sm font-semibold text-white"
                    >
                      <MessageSquareText size={15} /> Add to canvas
                    </button>
                  )}
                </div>
              )}
            </div>
            <p className="border-t border-stone-100 p-4 text-center text-[11px] leading-relaxed text-stone-400">
              AI can make mistakes. Review generated content before relying on
              it.
            </p>
          </div>
        </aside>
      </div>
      {error && (
        <div className="absolute bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-xl bg-red-700 px-4 py-3 text-sm text-white shadow-soft">
          {error}
          <button onClick={() => setError("")}>
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

function ToolButton({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className="rounded-lg p-2 text-stone-500 transition hover:bg-stone-100 hover:text-ink"
    >
      {children}
    </button>
  );
}
function SaveBadge({ state }: { state: SaveStatus }) {
  const content =
    state === "saving" ? (
      <>
        <Loader2 className="animate-spin" size={13} />
        Saving
      </>
    ) : state === "saved" ? (
      <>
        <Check size={13} />
        Saved
      </>
    ) : state === "unsaved" ? (
      "Unsaved"
    ) : state === "conflict" ? (
      "Conflict"
    ) : (
      "Save failed"
    );
  return (
    <span
      className={`flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs ${state === "error" || state === "conflict" ? "bg-red-50 text-red-700" : "text-stone-400"}`}
    >
      {content}
    </span>
  );
}

export function BoardPage() {
  return (
    <ReactFlowProvider>
      <BoardEditor />
    </ReactFlowProvider>
  );
}
