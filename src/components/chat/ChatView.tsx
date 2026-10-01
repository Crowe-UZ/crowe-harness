import { MessageSquareDashed, SearchX, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { EmptyState } from "@/components/common/EmptyState";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { Project } from "@/data/types";
import type { PermissionDecision, PermissionMode } from "@/features/ai/types";
import { mergeAssistantRuns, transcriptToView, type MessageView } from "@/features/chat/view-model";
import { draftKey, isBusy, useChatStore } from "@/stores/chatStore";
import { transcriptKey, useSessionStore } from "@/stores/sessionStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { AgentLinkContext } from "./agent-link";
import { ChatNotices } from "./ChatNotices";
import { Composer } from "./Composer";
import { Conversation } from "./Conversation";
import { PermissionPrompt } from "./PermissionPrompt";

const NO_MESSAGES: MessageView[] = [];
/** Distance from the bottom (px) within which the view keeps following new output. */
const PIN_THRESHOLD = 48;

/** Navigation state used when a chat continues under a new route (new chat → its real session id). */
export interface ChatNavigationState {
  /** React key of the chat view that should stay mounted across the route change. */
  chatInstance: string;
  /** Do not move focus to the main region (the user is still typing or watching the reply). */
  keepFocus: true;
}

/**
 * A chat of a project: the stored transcript (Claude Code history) followed by
 * the live turn. `sessionId === null` is a new chat; its first turn creates the
 * session and the view continues under /projects/:projectId/sessions/:id.
 */
export function ChatView({
  project,
  sessionId,
  instanceKey,
}: {
  project: Project;
  sessionId: string | null;
  instanceKey: string;
}) {
  const projectId = project.id;
  const key = sessionId ?? draftKey(projectId);
  const navigate = useNavigate();
  const chat = useChatStore((s) => s.chats[key]);
  const redirect = useChatStore((s) => s.redirects[key]);
  const storedMode = useChatStore((s) => s.modes[key]);
  const defaultMode = useSettingsStore((s) => s.defaultPermissionMode);
  const send = useChatStore((s) => s.send);
  const stop = useChatStore((s) => s.stop);
  const setMode = useChatStore((s) => s.setMode);
  const dismissNotice = useChatStore((s) => s.dismissNotice);
  const respondToPermission = useChatStore((s) => s.respondToPermission);
  const consumeRedirect = useChatStore((s) => s.consumeRedirect);
  const transcript = useSessionStore((s) =>
    sessionId ? s.transcripts[transcriptKey(projectId, sessionId)] : undefined,
  );
  const loadTranscript = useSessionStore((s) => s.loadTranscript);
  const scrollRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const pinnedRef = useRef(true);

  const mode = storedMode ?? defaultMode;
  const status = chat?.status;
  const running = status === "running";
  const busy = isBusy(status);
  const live = chat?.messages ?? NO_MESSAGES;
  const data = transcript?.data;

  const reload = useCallback(() => {
    if (sessionId) void loadTranscript(projectId, sessionId);
  }, [loadTranscript, projectId, sessionId]);

  // Opening a chat always refreshes it — unless a live turn is showing messages that are not stored yet.
  useEffect(() => {
    if (!sessionId || useChatStore.getState().chats[sessionId]?.messages.length) return;
    void loadTranscript(projectId, sessionId);
  }, [loadTranscript, projectId, sessionId]);

  // The first turn of a new chat reports its session id: continue under the chat's real route.
  useEffect(() => {
    if (!redirect) return;
    consumeRedirect(key);
    const state: ChatNavigationState = { chatInstance: instanceKey, keepFocus: true };
    void navigate(`/projects/${projectId}/sessions/${redirect}`, { replace: true, state });
  }, [redirect, consumeRedirect, key, instanceKey, navigate, projectId]);

  const stored = useMemo(() => (data ? transcriptToView(data.messages) : NO_MESSAGES), [data]);
  const liveView = useMemo(() => mergeAssistantRuns(live), [live]);
  const messages = useMemo(() => (liveView.length ? [...stored, ...liveView] : stored), [stored, liveView]);
  const agentLinks = useMemo(() => {
    const byToolUse = new Map(
      (data?.subagents ?? []).flatMap((a) => (a.toolUseId ? [[a.toolUseId, a.id] as const] : [])),
    );
    return (toolUseId: string) => {
      const agentId = byToolUse.get(toolUseId);
      return agentId && sessionId ? `/projects/${projectId}/sessions/${sessionId}/agents/${agentId}` : undefined;
    };
  }, [data, projectId, sessionId]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && pinnedRef.current) el.scrollTop = el.scrollHeight;
  }, [messages, chat?.error, chat?.notices, chat?.pendingPermission]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (el) pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight <= PIN_THRESHOLD;
  };

  const onSend = (text: string) => {
    pinnedRef.current = true;
    void send(key, { projectId, sessionId }, text, mode);
  };

  const onDecide = (decision: PermissionDecision) => {
    void respondToPermission(key, decision);
    // The prompt unmounts after a decision; hand focus back to the composer instead of losing it.
    composerRef.current?.focus();
  };

  // Stored transcript not available and nothing live to show: loading or failure states.
  if (sessionId && !data && live.length === 0) {
    if (!transcript || transcript.status === "loading") return <TranscriptSkeleton />;
    if (transcript.notFound) {
      return (
        <Centered>
          <EmptyState
            icon={SearchX}
            tone="danger"
            title="Chat not found"
            description="Claude Code has no chat with this id in this project."
            action={
              <Button variant="outline" size="sm" asChild>
                <Link to={`/projects/${projectId}`}>Open project</Link>
              </Button>
            }
          />
        </Centered>
      );
    }
    return (
      <Centered>
        <EmptyState
          icon={TriangleAlert}
          tone="danger"
          title="Could not load this chat"
          description={transcript.error}
          action={
            <Button variant="outline" size="sm" onClick={reload}>
              Retry
            </Button>
          }
        />
      </Centered>
    );
  }

  const statusText = running
    ? "Claude is responding"
    : status === "awaiting_permission"
      ? "Waiting for your permission"
      : "";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-y-auto"
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        aria-busy={running || undefined}
        aria-label="Conversation"
      >
        {messages.length === 0 ? (
          <div className="mx-auto max-w-3xl px-6 py-6">
            <EmptyState
              icon={MessageSquareDashed}
              title={sessionId ? "This chat has no messages" : "Start a new chat"}
              description={`Claude Code works in ${project.path ?? project.name}. Describe a task — for example “Explain how this project is structured”.`}
            />
          </div>
        ) : (
          <AgentLinkContext.Provider value={agentLinks}>
            <Conversation messages={messages} truncated={data?.truncated} />
          </AgentLinkContext.Provider>
        )}
      </div>
      <p role="status" className="sr-only">
        {statusText}
      </p>
      <div className="mx-auto w-full max-w-3xl space-y-3 px-6 pb-4">
        {transcript?.status === "error" && (data || live.length > 0) ? (
          <div className="flex items-center gap-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <p role="alert" className="flex-1">
              Could not refresh this chat: {transcript.error}
            </p>
            <Button variant="outline" size="xs" onClick={reload}>
              Retry
            </Button>
          </div>
        ) : null}
        {chat?.error ? (
          <p
            role="alert"
            className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {chat.error}
          </p>
        ) : null}
        <ChatNotices notices={chat?.notices ?? []} onDismiss={(id) => dismissNotice(key, id)} />
        {chat?.pendingPermission ? <PermissionPrompt request={chat.pendingPermission} onDecide={onDecide} /> : null}
        <Composer
          inputRef={composerRef}
          running={busy}
          mode={mode}
          onModeChange={(next: PermissionMode) => setMode(key, next)}
          placeholder={sessionId ? "Continue the chat…" : "Describe a task for Claude…"}
          onSend={onSend}
          onStop={() => void stop(key)}
        />
      </div>
    </div>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="flex h-full items-center justify-center p-8">{children}</div>;
}

function TranscriptSkeleton() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 px-6 py-6" role="status">
      <span className="sr-only">Loading chat…</span>
      {[70, 90, 55].map((w) => (
        <div key={w} className="flex gap-3">
          <Skeleton className="size-7 shrink-0 rounded-md" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-4" style={{ width: `${w}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}
