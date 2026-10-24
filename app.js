// ---- State ---------------------------------------------------------------

let tasks = load();
let nextId = tasks.reduce((max, t) => Math.max(max, t.id), 0) + 1;

function load() {
  try { return JSON.parse(localStorage.getItem("tasks")) || []; } catch { return []; }
}

function save() {
  try { localStorage.setItem("tasks", JSON.stringify(tasks)); } catch {}
}

const PRIORITIES = ["low", "normal", "high"];

function oneOf(name, value, allowed) {
  if (!allowed.includes(value)) throw new Error(`${name} must be one of: ${allowed.join(", ")}`);
  return value;
}

function addTask(title, priority = "normal") {
  oneOf("priority", priority, PRIORITIES);
  const task = { id: nextId++, title: title.trim(), priority, done: false };
  tasks.push(task);
  save();
  render();
  return task;
}

function findTask(id) {
  const task = tasks.find(t => t.id === Number(id));
  if (!task) throw new Error(`No task with id ${id}`);
  return task;
}

// ---- Rendering -----------------------------------------------------------

const listEl = document.getElementById("task-list");
const emptyEl = document.getElementById("empty");
const countEl = document.getElementById("count");
const logEl = document.getElementById("log");

function render() {
  listEl.innerHTML = "";
  for (const t of tasks) {
    const li = document.createElement("li");
    li.className = t.done ? "done" : "";
    li.innerHTML = `
      <input type="checkbox" ${t.done ? "checked" : ""}>
      <span class="title"></span>
      <span class="tag"></span>
      <span class="id">#${t.id}</span>
      <button class="delete" title="Delete">✕</button>`;
    li.querySelector(".title").textContent = t.title;
    // Priority comes from storage/agents, so never treat it as markup.
    const tag = li.querySelector(".tag");
    tag.textContent = t.priority;
    if (PRIORITIES.includes(t.priority)) tag.classList.add(t.priority);
    li.querySelector("input").onchange = e => { t.done = e.target.checked; save(); render(); };
    li.querySelector(".delete").onclick = () => { tasks = tasks.filter(x => x !== t); save(); render(); };
    listEl.appendChild(li);
  }
  const open = tasks.filter(t => !t.done).length;
  emptyEl.hidden = tasks.length > 0;
  countEl.textContent = tasks.length ? `${open} open / ${tasks.length} total` : "";
}

function log(msg) {
  const li = document.createElement("li");
  li.textContent = `${new Date().toLocaleTimeString()}  ${msg}`;
  logEl.prepend(li);
}

// ---- Manual form ---------------------------------------------------------

const form = document.getElementById("add-form");
form.addEventListener("submit", e => {
  e.preventDefault();
  const data = new FormData(form);
  const task = addTask(data.get("title"), data.get("priority"));
  // When an agent submits this form via declarative WebMCP, hand back a result.
  // Reset only after responding: Chrome cancels a pending tool call on form reset.
  if (e.agentInvoked && e.respondWith) {
    log(`add_task_form → #${task.id}`);
    e.respondWith(Promise.resolve(`Added task #${task.id}: "${task.title}"`));
    setTimeout(() => form.reset(), 0);
  } else {
    form.reset();
  }
});

// ---- WebMCP tools --------------------------------------------------------

const text = value => ({
  content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }],
});

const tools = [
  {
    name: "list_tasks",
    description: "List all tasks on the page with their id, title, priority and done status.",
    inputSchema: {
      type: "object",
      properties: {
        filter: { type: "string", enum: ["all", "open", "done"], description: "Which tasks to return. Defaults to all." },
      },
    },
    execute: ({ filter = "all" } = {}) => {
      oneOf("filter", filter, ["all", "open", "done"]);
      const result = tasks.filter(t => filter === "all" || (filter === "done") === t.done);
      return text(result);
    },
  },
  {
    name: "add_task",
    description: "Add a new task to the list.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short title of the task" },
        priority: { type: "string", enum: ["low", "normal", "high"], description: "Defaults to normal." },
      },
      required: ["title"],
    },
    execute: ({ title, priority = "normal" }) => {
      if (!title || !title.trim()) throw new Error("title is required");
      const task = addTask(title, priority);
      return text(`Added task #${task.id}: "${task.title}" (${task.priority})`);
    },
  },
  {
    name: "complete_task",
    description: "Mark a task as done (or not done) by its id.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", description: "The task id, as returned by list_tasks" },
        done: { type: "boolean", description: "Defaults to true." },
      },
      required: ["id"],
    },
    execute: ({ id, done = true }) => {
      if (typeof done !== "boolean") throw new Error("done must be true or false");
      const task = findTask(id);
      task.done = done;
      save();
      render();
      return text(`Task #${task.id} marked ${done ? "done" : "not done"}`);
    },
  },
  {
    name: "delete_task",
    description: "Delete a task by its id.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "number", description: "The task id to delete" } },
      required: ["id"],
    },
    execute: ({ id }) => {
      const task = findTask(id);
      tasks = tasks.filter(t => t !== task);
      save();
      render();
      return text(`Deleted task #${task.id}: "${task.title}"`);
    },
  },
  {
    name: "clear_completed",
    description: "Remove every task that is marked done.",
    inputSchema: { type: "object", properties: {} },
    execute: () => {
      const before = tasks.length;
      tasks = tasks.filter(t => !t.done);
      save();
      render();
      return text(`Removed ${before - tasks.length} completed task(s)`);
    },
  },
  {
    name: "set_theme",
    description: "Switch the page between light and dark theme.",
    inputSchema: {
      type: "object",
      properties: { theme: { type: "string", enum: ["light", "dark"] } },
      required: ["theme"],
    },
    execute: ({ theme }) => {
      document.documentElement.dataset.theme = oneOf("theme", theme, ["light", "dark"]);
      return text(`Theme set to ${theme}`);
    },
  },
];

// Wrap each tool so calls show up in the on-page activity log.
const logged = tools.map(tool => ({
  ...tool,
  execute: async (input = {}) => {
    log(`${tool.name}(${JSON.stringify(input)})`);
    try {
      return await tool.execute(input);
    } catch (err) {
      log(`  ✗ ${err.message}`);
      return { ...text(`Error: ${err.message}`), isError: true };
    }
  },
}));

// The spec moved the API to document.modelContext; keep the old spot for older builds.
const getModelContext = () => document.modelContext || navigator.modelContext;

function registerWebMCP() {
  const statusEl = document.getElementById("mcp-status");
  const mc = getModelContext();

  if (!mc) {
    statusEl.textContent = "WebMCP not available in this browser — the page still works by hand.";
    statusEl.className = "status off";
    return false;
  }

  if (typeof mc.registerTool === "function") {
    logged.forEach(tool => mc.registerTool(tool));
  } else if (typeof mc.provideContext === "function") {
    mc.provideContext({ tools: logged });
  }

  statusEl.textContent = `WebMCP active — ${logged.length} tools registered: ${logged.map(t => t.name).join(", ")}`;
  statusEl.className = "status on";
  log(`registered ${logged.length} tools`);
  return true;
}

// An extension or polyfill may install the API after this script runs,
// so keep checking for a few seconds before giving up.
function registerWhenReady(intervalMs = 500, maxTries = 20) {
  if (registerWebMCP()) return;
  let tries = 0;
  const timer = setInterval(() => {
    if (getModelContext()) {
      clearInterval(timer);
      registerWebMCP();
    } else if (++tries >= maxTries) {
      clearInterval(timer);
    }
  }, intervalMs);
}

render();
registerWhenReady();
