import * as React from "react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import {
  Monitor,
  Eye,
  FolderOpen,
  FileBarChart,
  Globe,
  Smartphone,
  Home,
  Workflow,
  Upload,
  QrCode,
  Power,
  Trash2,
  Play,
  RefreshCw,
  Download,
  FolderSearch,
} from "lucide-react";
import { GlassCard, SectionTitle, RiskBadge, ResultView, Spinner, ORBITRON } from "./ui";
import { useToolCall, useStatus } from "./api";
import { QRCodeSVG } from "qrcode.react";

type AnyResult = {
  success: boolean;
  message?: string;
  data?: Record<string, unknown>;
  error?: string;
};

function useLocalTool() {
  const mutation = useToolCall();
  const [results, setResults] = React.useState<Record<string, AnyResult>>({});
  const run = React.useCallback(
    async (key: string, tool: string, params: Record<string, unknown> = {}) => {
      const r = (await mutation.mutateAsync({ tool, params })) as AnyResult;
      setResults((prev) => ({ ...prev, [key]: r }));
      return r;
    },
    [mutation],
  );
  return { run, results, loading: mutation.isPending };
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

const inputCls =
  "w-full rounded-lg border border-border bg-background/60 px-3 py-2 text-sm text-foreground outline-none focus:border-primary/60";

// ---------------------------------------------------------------------------
// Dashboard cards
// ---------------------------------------------------------------------------

const CARDS = [
  {
    to: "/command-center/pc",
    icon: Monitor,
    title: "PC CONTROL",
    desc: "Open apps, navigate, screenshot, system info.",
    status: "Ready",
  },
  {
    to: "/command-center/vision",
    icon: Eye,
    title: "VISION",
    desc: "Analyze screen & webcam with AI vision.",
    status: "Ready",
  },
  {
    to: "/command-center/files",
    icon: FolderOpen,
    title: "FILE COMMANDER",
    desc: "Browse, search, organize your files.",
    status: "Ready",
  },
  {
    to: "/command-center/office",
    icon: FileBarChart,
    title: "OFFICE GENERATOR",
    desc: "Generate PowerPoint, Excel, Word.",
    status: "Ready",
  },
  {
    to: "/command-center/browser",
    icon: Globe,
    title: "BROWSER AGENT",
    desc: "Search, open, and summarize the web.",
    status: "Ready",
  },
  {
    to: "/command-center/mobile",
    icon: Smartphone,
    title: "MOBILE LINK",
    desc: "Pair your Android companion.",
    status: "Not Connected",
  },
  {
    to: "/command-center/smart-home",
    icon: Home,
    title: "SMART HOME",
    desc: "Control ESP32 & IoT devices.",
    status: "Offline",
  },
  {
    to: "/command-center/automations",
    icon: Workflow,
    title: "AUTOMATIONS",
    desc: "Trigger → Condition → Action.",
    status: "Ready",
  },
];

export function DashboardCards() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {CARDS.map((c) => (
        <GlassCard key={c.to} className="group flex flex-col p-5">
          <div className="flex items-start justify-between">
            <div className="rounded-xl border border-primary/30 bg-primary/10 p-2 text-primary transition group-hover:shadow-[0_0_20px_rgba(66,133,244,0.4)]">
              <c.icon className="h-6 w-6" />
            </div>
            <span
              className={
                "rounded-full border px-2 py-0.5 text-[10px] uppercase " +
                (c.status === "Ready"
                  ? "border-emerald-500/30 text-emerald-300"
                  : "border-zinc-600 text-zinc-400")
              }
            >
              {c.status}
            </span>
          </div>
          <h3
            className="mt-3 text-base font-semibold tracking-wide text-foreground"
            style={ORBITRON}
          >
            {c.title}
          </h3>
          <p className="mt-1 flex-1 text-sm text-muted-foreground">{c.desc}</p>
          <Link to={c.to} className="mt-4">
            <Button className="w-full bg-primary/90 hover:bg-primary">Open / Launch</Button>
          </Link>
        </GlassCard>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PC Control
// ---------------------------------------------------------------------------

export function PcPanel() {
  const { run, results } = useLocalTool();
  const [app, setApp] = React.useState("");
  const [apps, setApps] = React.useState<string[]>([]);
  const [folder, setFolder] = React.useState(".");

  return (
    <GlassCard className="p-5">
      <SectionTitle hint="safe · permission-gated">PC CONTROL</SectionTitle>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Button
            onClick={async () => {
              const r = await run("sys", "pc.system_info");
              if (r.success) console.log(r.data);
            }}
          >
            Read System Info
          </Button>
          <Button
            variant="outline"
            onClick={async () => {
              const r = await run("apps", "pc.list_apps");
              if (r.success)
                setApps((r.data?.apps as { name: string }[])?.map((a) => a.name) ?? []);
            }}
          >
            List Apps
          </Button>
          <div className="flex gap-2">
            <select className={inputCls} value={app} onChange={(e) => setApp(e.target.value)}>
              <option value="">Select app…</option>
              {apps.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
            <Button disabled={!app} onClick={() => run("launch", "pc.launch_app", { app })}>
              Launch
            </Button>
          </div>
          <div className="flex gap-2">
            <input
              className={inputCls}
              value={folder}
              onChange={(e) => setFolder(e.target.value)}
              placeholder="Folder path"
            />
            <Button
              variant="outline"
              onClick={() => run("nav", "pc.navigate_folder", { path: folder })}
            >
              List
            </Button>
          </div>
          <Button variant="secondary" onClick={() => run("shot", "pc.screenshot")}>
            Take Screenshot
          </Button>
        </div>
        <div className="space-y-2 overflow-auto text-sm">
          {results.sys?.success && (
            <pre className="rounded-lg border border-border bg-background/60 p-3 text-xs text-emerald-200">
              {JSON.stringify(results.sys.data?.info, null, 2)}
            </pre>
          )}
          {results.nav?.success && (
            <ResultView success message={`${results.nav.message}`}>
              <div className="font-mono">{(results.nav.data?.entries as string[])?.join("\n")}</div>
            </ResultView>
          )}
          {results.launch && (
            <ResultView success={results.launch.success} message={results.launch.message ?? ""} />
          )}
          {results.shot && (
            <ResultView success={results.shot.success} message={results.shot.message ?? ""} />
          )}
          {results.apps?.success && (
            <p className="text-muted-foreground">Launchable: {apps.join(", ")}</p>
          )}
        </div>
      </div>
    </GlassCard>
  );
}

// ---------------------------------------------------------------------------
// File Commander
// ---------------------------------------------------------------------------

export function FilesPanel() {
  const { run, results } = useLocalTool();
  const [path, setPath] = React.useState(".");
  const [query, setQuery] = React.useState("");

  return (
    <GlassCard className="p-5">
      <SectionTitle hint="real filesystem · within allowed dirs">FILE COMMANDER</SectionTitle>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-3">
          <Field label="Browse folder">
            <div className="flex gap-2">
              <input className={inputCls} value={path} onChange={(e) => setPath(e.target.value)} />
              <Button onClick={() => run("browse", "files.browse", { path })}>Browse</Button>
            </div>
          </Field>
          <Field label="Search files">
            <div className="flex gap-2">
              <input
                className={inputCls}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="filename…"
              />
              <Button variant="outline" onClick={() => run("search", "files.search", { query })}>
                <FolderSearch className="mr-1 h-4 w-4" />
                Search
              </Button>
            </div>
          </Field>
          <div className="rounded-xl border border-border bg-background/40 p-3">
            <p className="mb-2 text-sm text-muted-foreground">
              Organize a folder (propose → review → apply):
            </p>
            <div className="flex gap-2">
              <input
                className={inputCls}
                value={path}
                onChange={(e) => setPath(e.target.value)}
                placeholder="Folder to organize"
              />
            </div>
            <div className="mt-2 flex gap-2">
              <Button
                variant="outline"
                onClick={() => run("plan", "files.organize_plan", { path })}
              >
                Plan
              </Button>
              <Button onClick={() => run("apply", "files.organize_apply", { path })}>Apply</Button>
              <Button variant="secondary" onClick={() => run("undo", "files.undo")}>
                Undo
              </Button>
            </div>
          </div>
        </div>
        <div className="space-y-2 overflow-auto text-sm">
          {results.browse?.success && (
            <ResultView success message={results.browse.message ?? ""}>
              <div className="font-mono">
                {(results.browse.data?.entries as { name: string; isDir: boolean }[])
                  ?.map((e) => `${e.isDir ? "📁" : "📄"} ${e.name}`)
                  .join("\n")}
              </div>
            </ResultView>
          )}
          {results.search?.success && (
            <ResultView success message={results.search.message ?? ""}>
              <div className="font-mono break-all">
                {(results.search.data?.hits as string[])?.join("\n")}
              </div>
            </ResultView>
          )}
          {results.plan?.success && (
            <ResultView success message={results.plan.message ?? ""}>
              <div className="font-mono text-xs">
                {Object.entries((results.plan.data?.plan as Record<string, string[]>) ?? {})
                  .filter(([, v]) => v.length)
                  .map(([k, v]) => `${k}: ${v.length} file(s)`)
                  .join("\n")}
              </div>
            </ResultView>
          )}
          {results.apply && (
            <ResultView success={results.apply.success} message={results.apply.message ?? ""} />
          )}
          {results.undo && (
            <ResultView success={results.undo.success} message={results.undo.message ?? ""} />
          )}
        </div>
      </div>
    </GlassCard>
  );
}

// ---------------------------------------------------------------------------
// Vision
// ---------------------------------------------------------------------------

export function VisionPanel() {
  const { run, results } = useLocalTool();
  const [img, setImg] = React.useState<string | null>(null);
  const [question, setQuestion] = React.useState("Describe what you see.");
  const [cameraOn, setCameraOn] = React.useState(false);

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setImg(reader.result as string);
    reader.readAsDataURL(file);
  };

  return (
    <GlassCard className="p-5">
      <SectionTitle hint="Gemini / OpenAI vision">VISION ENGINE</SectionTitle>

      <div className="mb-4 flex items-center gap-3 rounded-xl border border-border bg-background/40 p-3">
        <Power className={"h-5 w-5 " + (cameraOn ? "text-emerald-400" : "text-zinc-500")} />
        <div className="flex-1">
          <p className="text-sm font-semibold">WEBCAM</p>
          <p className={"text-xs " + (cameraOn ? "text-emerald-300" : "text-zinc-400")}>
            {cameraOn ? "CAMERA ON" : "CAMERA OFF"}
          </p>
        </div>
        <Button
          variant={cameraOn ? "secondary" : "default"}
          onClick={async () => {
            const r = await run("cam", "vision.webcam_toggle", { on: !cameraOn });
            if (r.success) setCameraOn(Boolean(r.data?.cameraOn));
          }}
        >
          {cameraOn ? "Turn Off" : "Turn On"}
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-3">
          <Field label="Source: SCREEN or uploaded image">
            <div className="flex items-center gap-2 rounded-lg border border-dashed border-border p-3">
              <Upload className="h-5 w-5 text-muted-foreground" />
              <input
                type="file"
                accept="image/*"
                onChange={onFile}
                className="text-sm text-muted-foreground"
              />
            </div>
          </Field>
          {img && (
            <img src={img} alt="source" className="max-h-48 rounded-lg border border-border" />
          )}
          <Field label="Question">
            <textarea
              className={inputCls}
              rows={2}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
            />
          </Field>
          <Button
            disabled={!img}
            onClick={() => img && run("analyze", "vision.analyze", { image: img, question })}
          >
            Analyze Image
          </Button>
          {!img && (
            <p className="text-xs text-muted-foreground">
              Upload a screenshot or photo to analyze. Native screen capture requires
              LORD_SCREEN_CAPTURE_CMD.
            </p>
          )}
        </div>
        <div className="text-sm">
          {results.analyze?.success ? (
            <ResultView success message={results.analyze.message ?? ""}>
              <p className="whitespace-pre-wrap text-foreground/90">
                {results.analyze.data?.analysis as string}
              </p>
            </ResultView>
          ) : results.analyze ? (
            <ResultView success={false} message={results.analyze.message ?? ""} />
          ) : (
            <p className="text-muted-foreground">Analysis will appear here.</p>
          )}
        </div>
      </div>
    </GlassCard>
  );
}

// ---------------------------------------------------------------------------
// Office Generator
// ---------------------------------------------------------------------------

function OfficeForm({
  kind,
  icon: Icon,
}: {
  kind: "powerpoint" | "excel" | "document";
  icon: React.ComponentType<{ className?: string }>;
}) {
  const { run, results } = useLocalTool();
  const [topic, setTopic] = React.useState("");
  const [count, setCount] = React.useState(8);
  const key = kind;

  const r = results[key];
  const file = r?.data?.location as string | undefined;

  return (
    <GlassCard className="p-4">
      <SectionTitle hint={kind.toUpperCase()}>
        <span className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-primary" />
          {kind.toUpperCase()}
        </span>
      </SectionTitle>
      <Field label="Topic">
        <input
          className={inputCls}
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder={`Subject for ${kind}`}
        />
      </Field>
      {kind !== "document" && (
        <Field label="Count (slides/rows)">
          <input
            type="number"
            className={inputCls}
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
          />
        </Field>
      )}
      <Button
        className="mt-3 w-full"
        disabled={!topic}
        onClick={() =>
          run(
            key,
            `office.${kind}`,
            kind === "document"
              ? { topic }
              : { topic, [kind === "excel" ? "rows" : "slides"]: count },
          )
        }
      >
        {r?.success ? "Re-generate" : "Generate"}
      </Button>
      {r && (
        <div className="mt-3">
          <ResultView success={r.success} message={r.message ?? ""} />
          {file && (
            <div className="mt-2 flex gap-2">
              <a
                href={`/api/lord/file?path=${encodeURIComponent(file)}`}
                target="_blank"
                rel="noreferrer"
              >
                <Button size="sm" variant="outline">
                  <Download className="mr-1 h-4 w-4" />
                  Open
                </Button>
              </a>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => navigator.clipboard.writeText(file)}
              >
                Reveal in folder
              </Button>
            </div>
          )}
        </div>
      )}
    </GlassCard>
  );
}

export function OfficePanel() {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <OfficeForm kind="powerpoint" icon={FileBarChart} />
      <OfficeForm kind="excel" icon={FileBarChart} />
      <OfficeForm kind="document" icon={FileBarChart} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Browser Agent
// ---------------------------------------------------------------------------

export function BrowserPanel() {
  const { run, results } = useLocalTool();
  const [url, setUrl] = React.useState("");
  const [query, setQuery] = React.useState("");

  return (
    <GlassCard className="p-5">
      <SectionTitle hint="search · open · summarize">BROWSER AGENT</SectionTitle>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-3">
          <Field label="Search the web">
            <div className="flex gap-2">
              <input
                className={inputCls}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="e.g. photosynthesis"
              />
              <Button onClick={() => run("search", "browser.search", { query })}>Search</Button>
            </div>
          </Field>
          <Field label="Open / summarize URL">
            <div className="flex gap-2">
              <input
                className={inputCls}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://…"
              />
            </div>
            <div className="mt-2 flex gap-2">
              <Button variant="outline" onClick={() => run("open", "browser.open", { url })}>
                Open
              </Button>
              <Button onClick={() => run("sum", "browser.summarize", { url })}>Summarize</Button>
            </div>
          </Field>
        </div>
        <div className="space-y-2 overflow-auto text-sm">
          {results.search?.success && (
            <ResultView success message={results.search.message ?? ""}>
              <ul className="space-y-1 text-xs">
                {(results.search.data?.results as { title: string; url: string }[])?.map((r, i) => (
                  <li key={i}>
                    <a
                      className="text-primary hover:underline"
                      href={r.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {r.title}
                    </a>
                  </li>
                ))}
              </ul>
            </ResultView>
          )}
          {results.sum?.success && (
            <ResultView success message={results.sum.message ?? ""}>
              <p className="whitespace-pre-wrap">{results.sum.data?.summary as string}</p>
            </ResultView>
          )}
          {results.open?.success && (
            <ResultView success message={results.open.message ?? ""}>
              <p className="font-mono text-xs break-all">
                {(results.open.data?.text as string)?.slice(0, 600)}
              </p>
            </ResultView>
          )}
        </div>
      </div>
    </GlassCard>
  );
}

// ---------------------------------------------------------------------------
// Mobile Link
// ---------------------------------------------------------------------------

export function MobilePanel() {
  const { run, results } = useLocalTool();
  const statusQ = useStatus();
  const [qr, setQr] = React.useState<{ payload: string; token: string; expiresAt: number } | null>(
    null,
  );
  const [deviceName, setDeviceName] = React.useState("Lord Mobile");
  const devices = (statusQ.data?.connections?.mobile === "online" ? [] : []) as unknown[];

  const startPairing = async () => {
    const r = await run("pair", "mobile.pair_start");
    if (r.success && r.data) {
      setQr({
        payload: r.data.qrPayload as string,
        token: r.data.token as string,
        expiresAt: r.data.expiresAt as number,
      });
    }
  };

  const complete = async () => {
    if (!qr) return;
    const r = await run("complete", "mobile.pair_complete", { token: qr.token, deviceName });
    if (r.success) setQr(null);
  };

  return (
    <GlassCard className="p-5">
      <SectionTitle hint="pair your Android device">MOBILE LINK</SectionTitle>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-3">
          <div className="rounded-xl border border-border bg-background/40 p-4 text-center">
            <p className="mb-2 text-sm font-semibold">PAIR YOUR ANDROID DEVICE</p>
            {qr ? (
              <>
                <div className="flex justify-center rounded-lg bg-white p-3">
                  <QRCodeSVG value={qr.payload} size={160} />
                </div>
                <p className="mt-2 text-xs text-amber-300">Waiting for device…</p>
                <p className="mt-1 font-mono text-[10px] text-muted-foreground break-all">
                  {qr.payload}
                </p>
                <div className="mt-3 flex gap-2">
                  <input
                    className={inputCls}
                    value={deviceName}
                    onChange={(e) => setDeviceName(e.target.value)}
                  />
                  <Button onClick={complete}>Simulate Connect</Button>
                </div>
                <p className="mt-2 text-[10px] text-muted-foreground">
                  Token rotates each session; expires {new Date(qr.expiresAt).toLocaleTimeString()}.
                </p>
              </>
            ) : (
              <Button onClick={startPairing}>
                <QrCode className="mr-1 h-4 w-4" />
                Generate Pairing QR
              </Button>
            )}
          </div>
        </div>
        <div className="text-sm">
          <p className="mb-2 font-semibold text-foreground">Connection</p>
          {statusQ.data?.connections?.mobile === "online" ? (
            <ResultView success message="LORD MOBILE CONNECTED">
              <p className="text-xs">Device paired and online.</p>
            </ResultView>
          ) : (
            <p className="text-muted-foreground">
              No device connected. Scan the QR with Lord Mobile on the same local network.
            </p>
          )}
          {results.complete && (
            <ResultView
              success={results.complete.success}
              message={results.complete.message ?? ""}
            />
          )}
        </div>
      </div>
    </GlassCard>
  );
}

// ---------------------------------------------------------------------------
// Smart Home
// ---------------------------------------------------------------------------

export function SmartHomePanel() {
  const { run, results } = useLocalTool();
  const statusQ = useStatus();
  const [name, setName] = React.useState("");
  const [kind, setKind] = React.useState("light");
  const [endpoint, setEndpoint] = React.useState("");

  // Devices are stored server-side; reflect via a local list after actions.
  const [devices, setDevices] = React.useState<
    {
      id: string;
      name: string;
      kind: string;
      state: string;
      online: boolean;
      sensors?: Record<string, number>;
    }[]
  >([]);

  React.useEffect(() => {
    run("list", "sm.devices").then((r) => {
      if (r.success && r.data) setDevices((r.data.devices as typeof devices) ?? []);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refresh = () =>
    run("list", "sm.devices").then((r) => {
      if (r.success && r.data) setDevices((r.data.devices as typeof devices) ?? []);
    });

  return (
    <GlassCard className="p-5">
      <SectionTitle hint="ESP32 / IoT">SMART HOME</SectionTitle>
      <div className="mb-4 grid gap-3 rounded-xl border border-border bg-background/40 p-3 md:grid-cols-4">
        <input
          className={inputCls}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Device name"
        />
        <select className={inputCls} value={kind} onChange={(e) => setKind(e.target.value)}>
          {["relay", "light", "sensor", "switch", "fan", "other"].map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        <input
          className={inputCls}
          value={endpoint}
          onChange={(e) => setEndpoint(e.target.value)}
          placeholder="endpoint (e.g. /fan)"
        />
        <Button
          disabled={!name}
          onClick={async () => {
            await run("add", "sm.add_device", { name, kind, endpoint });
            setName("");
            setEndpoint("");
            refresh();
          }}
        >
          Add Device
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {devices.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No devices yet. Add one above. Set LORD_ESP32_BASE_URL to enable live control.
          </p>
        )}
        {devices.map((d) => (
          <GlassCard key={d.id} glow={false} className="p-3">
            <div className="flex items-center justify-between">
              <span className="font-semibold">{d.name}</span>
              <span
                className={
                  "text-[10px] uppercase " + (d.online ? "text-emerald-300" : "text-zinc-400")
                }
              >
                {d.online ? "online" : "offline"}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              {d.kind} · state: {d.state}
            </p>
            {d.sensors && (
              <p className="text-xs text-sky-300">
                {Object.entries(d.sensors)
                  .map(([k, v]) => `${k}: ${v}`)
                  .join(" · ")}
              </p>
            )}
            <div className="mt-2 flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  await run("ctl-" + d.id, "sm.control", {
                    deviceId: d.id,
                    state: d.state === "on" ? "off" : "on",
                  });
                  refresh();
                }}
              >
                {d.state === "on" ? "Turn Off" : "Turn On"}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={async () => {
                  await run("sens-" + d.id, "sm.read_sensors", { deviceId: d.id });
                  refresh();
                }}
              >
                <RefreshCw className="h-3 w-3" />
              </Button>
            </div>
          </GlassCard>
        ))}
      </div>
    </GlassCard>
  );
}

// ---------------------------------------------------------------------------
// Automations
// ---------------------------------------------------------------------------

export function AutomationsPanel() {
  const { run, results } = useLocalTool();
  const [name, setName] = React.useState("");
  const [triggerType, setTriggerType] = React.useState("command");
  const [triggerMatch, setTriggerMatch] = React.useState("");
  const [actions, setActions] = React.useState("");
  const [list, setList] = React.useState<
    {
      id: string;
      name: string;
      enabled: boolean;
      trigger: { type: string; match: string };
      actions: { tool: string }[];
      runCount?: number;
    }[]
  >([]);

  const refresh = () =>
    run("list", "automation.list").then((r) => {
      if (r.success && r.data) setList((r.data.automations as typeof list) ?? []);
    });
  React.useEffect(() => {
    refresh(); /* eslint-disable-next-line */
  }, []);

  return (
    <GlassCard className="p-5">
      <SectionTitle hint="TRIGGER → CONDITION → ACTION">AUTOMATION ENGINE</SectionTitle>
      <div className="mb-4 grid gap-3 rounded-xl border border-border bg-background/40 p-3 md:grid-cols-2">
        <Field label="Name">
          <input
            className={inputCls}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Study Mode"
          />
        </Field>
        <Field label="Trigger type">
          <select
            className={inputCls}
            value={triggerType}
            onChange={(e) => setTriggerType(e.target.value)}
          >
            {["command", "schedule", "file-event", "sensor-threshold", "manual"].map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Trigger match (phrase/metric)">
          <input
            className={inputCls}
            value={triggerMatch}
            onChange={(e) => setTriggerMatch(e.target.value)}
            placeholder="e.g. study mode"
          />
        </Field>
        <Field label="Actions (tool names, comma separated)">
          <input
            className={inputCls}
            value={actions}
            onChange={(e) => setActions(e.target.value)}
            placeholder="files.browse, pc.launch_app"
          />
        </Field>
        <div className="flex items-end">
          <Button
            disabled={!name || !actions}
            onClick={async () => {
              await run("create", "automation.create", {
                name,
                trigger: triggerType,
                triggerMatch,
                actions: actions
                  .split(",")
                  .map((a) => a.trim())
                  .filter(Boolean),
              });
              setName("");
              setActions("");
              refresh();
            }}
          >
            Create Automation
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        {list.length === 0 && <p className="text-sm text-muted-foreground">No automations yet.</p>}
        {list.map((a) => (
          <GlassCard
            key={a.id}
            glow={false}
            className="flex flex-wrap items-center justify-between gap-2 p-3"
          >
            <div>
              <p className="font-semibold">
                {a.name} {!a.enabled && <span className="text-xs text-zinc-500">(disabled)</span>}
              </p>
              <p className="text-xs text-muted-foreground">
                WHEN {a.trigger.type} = "{a.trigger.match}" →{" "}
                {a.actions.map((x) => x.tool).join(", ")} · runs: {a.runCount ?? 0}
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  await run("run-" + a.id, "automation.run", { id: a.id });
                  refresh();
                }}
              >
                <Play className="mr-1 h-3 w-3" />
                Run now
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={async () => {
                  await run("del-" + a.id, "automation.delete", { id: a.id });
                  refresh();
                }}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          </GlassCard>
        ))}
      </div>
    </GlassCard>
  );
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export function SettingsPanel() {
  const status = useStatus();
  const cfg = status.data?.configured;
  const Row = ({ label, value }: { label: string; value: string }) => (
    <div className="flex items-center justify-between border-b border-border py-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono text-xs text-foreground/80">{value}</span>
    </div>
  );
  return (
    <GlassCard className="p-5">
      <SectionTitle hint="configuration (env-driven)">COMMAND CENTER SETTINGS</SectionTitle>
      <div className="grid gap-6 md:grid-cols-2">
        <div>
          <h4 className="mb-1 text-sm font-semibold text-foreground">AI Providers</h4>
          <Row
            label="Gemini / OpenAI / OpenRouter"
            value={cfg?.ai ? "configured" : "not configured"}
          />
          <Row label="Vision model" value="gemini-3.5-flash (default)" />
          <h4 className="mb-1 mt-4 text-sm font-semibold text-foreground">Vision</h4>
          <Row label="Screen capture" value={cfg?.screen ? "enabled" : "not configured"} />
          <Row label="Webcam" value="toggle in Vision tab" />
        </div>
        <div>
          <h4 className="mb-1 text-sm font-semibold text-foreground">Smart Home</h4>
          <Row label="ESP32 controller" value={cfg?.esp32 ? "configured" : "not configured"} />
          <h4 className="mb-1 mt-4 text-sm font-semibold text-foreground">Security</h4>
          <Row label="Allowed directories" value="sandboxed (see config)" />
          <Row label="Tool permissions" value="low auto / med+high confirm" />
          <Row label="Emergency stop" value="STOP LORD button (top bar)" />
        </div>
      </div>
      <p className="mt-4 text-xs text-muted-foreground">
        Keys are read from environment variables (GEMINI_API_KEY, OPENAI_API_KEY,
        OPENROUTER_API_KEY, LORD_ESP32_BASE_URL, LORD_SCREEN_CAPTURE_CMD). Never hard-coded. Edit{" "}
        <span className="font-mono">.env</span> and restart to change.
      </p>
    </GlassCard>
  );
}
