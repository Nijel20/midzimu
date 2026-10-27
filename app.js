const DB_NAME = "midzimu-archive";
const DB_VERSION = 1;
const STORE_NAME = "stories";
const $ = (selector) => document.querySelector(selector);

const storyDialog = $("#story-dialog");
const privacyDialog = $("#privacy-dialog");
const storyForm = $("#story-form");
const storyList = $("#story-list");
const toast = $("#toast");
const objectUrls = new Set();
let stories = [];
let activeFilter = "all";
let recording = null;
let recorder = null;
let recordingStream = null;
let recordingChunks = [];
let currentAudio = null;
let audioSource = "new";
let toastTimer;

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function storeStory(story) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(story);
    transaction.oncomplete = () => { db.close(); resolve(); };
    transaction.onerror = () => { db.close(); reject(transaction.error); };
    transaction.onabort = () => { db.close(); reject(transaction.error); };
  });
}

async function readStories() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).getAll();
    request.onsuccess = () => { db.close(); resolve(request.result); };
    request.onerror = () => { db.close(); reject(request.error); };
  });
}

async function removeStory(id) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).delete(id);
    transaction.oncomplete = () => { db.close(); resolve(); };
    transaction.onerror = () => { db.close(); reject(transaction.error); };
    transaction.onabort = () => { db.close(); reject(transaction.error); };
  });
}

function notify(message, isError = false) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.toggle("is-error", isError);
  toast.classList.add("is-visible");
  toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 3600);
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(`${value}T12:00:00`);
  return new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric" }).format(date);
}

function makeElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function revokeObjectUrls() {
  for (const url of objectUrls) URL.revokeObjectURL(url);
  objectUrls.clear();
}

function audioUrl(blob) {
  if (!blob) return "";
  const url = URL.createObjectURL(blob);
  objectUrls.add(url);
  return url;
}

function storyCard(story) {
  const card = makeElement("article", "story-card");
  const top = makeElement("div", "card-top");
  top.append(makeElement("span", "category-label", story.category || "Memory"));
  top.append(makeElement("time", "card-date", formatDate(story.storyDate)));
  card.append(top);
  card.append(makeElement("h3", "", story.title));
  if (story.storyteller) card.append(makeElement("p", "card-storyteller", `Told by ${story.storyteller}`));
  if (story.transcript) card.append(makeElement("p", "card-excerpt", story.transcript));
  if (story.summary) card.append(makeElement("p", "card-excerpt", story.summary));
  if (story.proverb) card.append(makeElement("blockquote", "card-quote", `“${story.proverb}”`));
  if (story.audio instanceof Blob) {
    const player = makeElement("audio", "card-audio");
    player.controls = true;
    player.preload = "none";
    player.src = audioUrl(story.audio);
    player.setAttribute("aria-label", `Recording for ${story.title}`);
    card.append(player);
  }

  const footer = makeElement("div", "card-footer");
  footer.append(makeElement("span", "card-language", story.language || "Language not noted"));
  const edit = makeElement("button", "card-action", "Edit");
  edit.type = "button";
  edit.addEventListener("click", () => openStoryEditor(story));
  const remove = makeElement("button", "card-action", "Remove");
  remove.type = "button";
  remove.addEventListener("click", () => deleteStory(story));
  footer.append(edit, remove);
  card.append(footer);
  return card;
}

function renderStories() {
  revokeObjectUrls();
  storyList.replaceChildren();
  const query = $("#search-input").value.trim().toLocaleLowerCase();
  const visible = stories
    .filter((story) => activeFilter === "all" || story.category === activeFilter)
    .filter((story) => !query || [
      story.title, story.storyteller, story.category, story.language, story.transcript,
      story.proverb, story.summary, story.translation,
    ].some((value) => value?.toLocaleLowerCase().includes(query)));

  $("#story-count").textContent = `${stories.length} ${stories.length === 1 ? "story" : "stories"}`;
  if (visible.length) {
    storyList.append(...visible.map(storyCard));
    return;
  }

  const empty = makeElement("div", "empty-state");
  empty.append(makeElement("span", "empty-mark", "✳"));
  empty.append(makeElement("h3", "", query || activeFilter !== "all" ? "No stories found" : "Every archive begins with one story"));
  empty.append(makeElement("p", "", query || activeFilter !== "all"
    ? "Try another search or choose a different collection."
    : "A recipe, a saying, a childhood memory — start wherever the conversation takes you."));
  if (!query && activeFilter === "all") {
    const button = makeElement("button", "button button-green", "Preserve the first story");
    button.type = "button";
    button.addEventListener("click", () => openStoryEditor());
    empty.append(button);
  }
  storyList.append(empty);
}

function clearAudioPreview() {
  const preview = $("#audio-preview");
  if (preview.src.startsWith("blob:")) URL.revokeObjectURL(preview.src);
  preview.removeAttribute("src");
  preview.classList.add("hidden");
  $("#clear-audio").classList.add("hidden");
}

function setAudioPreview(blob) {
  clearAudioPreview();
  if (!blob) return;
  currentAudio = blob;
  audioSource = "new";
  const preview = $("#audio-preview");
  preview.src = URL.createObjectURL(blob);
  objectUrls.add(preview.src);
  preview.classList.remove("hidden");
  $("#clear-audio").classList.remove("hidden");
}

function resetForm() {
  stopRecording();
  storyForm.reset();
  $("#story-id").value = "";
  $("#ollama-url").value = localStorage.getItem("midzimu-ollama-url") || "http://localhost:11434";
  $("#ollama-model").value = localStorage.getItem("midzimu-ollama-model") || "gemma3:1b";
  $("#ai-status").textContent = "";
  $("#recording-status").textContent = "";
  currentAudio = null;
  audioSource = "new";
  recording = null;
  clearAudioPreview();
}

function openStoryEditor(story) {
  resetForm();
  if (story) {
    $("#story-id").value = story.id;
    $("#story-title").value = story.title || "";
    $("#storyteller").value = story.storyteller || "";
    $("#category").value = story.category || "Memory";
    $("#language").value = story.language || "";
    $("#story-date").value = story.storyDate || "";
    $("#transcript").value = story.transcript || "";
    $("#proverb").value = story.proverb || "";
    $("#summary").value = story.summary || "";
    $("#translation").value = story.translation || "";
    currentAudio = story.audio || null;
    audioSource = story.audio ? "existing" : "none";
    if (story.audio) setAudioPreview(story.audio);
  } else {
    $("#story-date").value = new Date().toISOString().slice(0, 10);
  }
  $("#dialog-title").textContent = story ? "Continue this story" : "Preserve a story";
  storyDialog.showModal();
  $("#story-title").focus();
}

async function deleteStory(story) {
  if (!window.confirm(`Remove “${story.title}” and its recording from this device? This cannot be undone.`)) return;
  try {
    await removeStory(story.id);
    await refreshStories();
    notify("Story removed from this device.");
  } catch (error) {
    console.error("Could not remove story:", error);
    notify("The story could not be removed. Please try again.", true);
  }
}

async function refreshStories() {
  stories = (await readStories()).sort((a, b) => {
    const aTime = a.updatedAt || a.createdAt || "1970-01-01T00:00:00.000Z";
    const bTime = b.updatedAt || b.createdAt || "1970-01-01T00:00:00.000Z";
    return bTime.localeCompare(aTime);
  });
  renderStories();
}

function stopRecording() {
  if (recorder?.state === "recording") recorder.stop();
  for (const track of recordingStream?.getTracks() || []) track.stop();
  recordingStream = null;
  recorder = null;
  $("#record-button").innerHTML = '<span aria-hidden="true">●</span> Record audio';
}

async function toggleRecording() {
  if (recorder?.state === "recording") {
    recorder.stop();
    for (const track of recordingStream?.getTracks() || []) track.stop();
    recordingStream = null;
    $("#record-button").textContent = "● Record audio";
    $("#recording-status").textContent = "Saving your recording…";
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    notify("Audio recording isn't available in this browser. You can choose an audio file instead.", true);
    return;
  }
  try {
    recordingStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const options = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? { mimeType: "audio/webm;codecs=opus" } : undefined;
    recorder = new MediaRecorder(recordingStream, options);
    recordingChunks = [];
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size) recordingChunks.push(event.data);
    });
    recorder.addEventListener("stop", () => {
      if (recordingChunks.length) {
        recording = new Blob(recordingChunks, { type: recorder?.mimeType || "audio/webm" });
        setAudioPreview(recording);
        $("#recording-status").textContent = "Recording ready. It will be saved with this story on this device.";
      }
      recordingChunks = [];
      for (const track of recordingStream?.getTracks() || []) track.stop();
      recordingStream = null;
    }, { once: true });
    recorder.start();
    $("#record-button").textContent = "■ Stop recording";
    $("#recording-status").textContent = "Recording on this device…";
  } catch (error) {
    console.error("Could not start recording:", error);
    notify(error.name === "NotAllowedError" ? "Microphone permission was denied. Allow microphone access or choose an audio file." : "Couldn't start audio recording. Choose an audio file instead.", true);
  }
}

async function organizeWithLocalAi() {
  const transcript = $("#transcript").value.trim();
  const endpoint = $("#ollama-url").value.trim().replace(/\/+$/, "");
  const model = $("#ollama-model").value.trim();
  const language = $("#language").value.trim() || "unspecified";
  const targetLanguage = $("#target-language").value.trim();
  const status = $("#ai-status");
  if (!transcript) {
    notify("Add the story text before asking the local AI to help.", true);
    $("#transcript").focus();
    return;
  }
  if (!endpoint || !model) {
    notify("Enter your local Ollama address and model name.", true);
    return;
  }

  localStorage.setItem("midzimu-ollama-url", endpoint);
  localStorage.setItem("midzimu-ollama-model", model);
  const button = $("#organize-button");
  button.disabled = true;
  status.textContent = `Asking ${model} on this device…`;
  try {
    const instructions = [
      "You are helping a family organize an oral-history archive.",
      "Treat the story as a historical source: do not add, infer, embellish, or correct facts.",
      "Keep personal names, quoted phrases, and culturally specific words faithful to the source.",
      "Return only a JSON object with string fields summary and translation, and an array of short string themes.",
      `The original language is ${language}.`,
      targetLanguage ? `Translate the story faithfully into ${targetLanguage} and put it in translation. Preserve names and the tone; flag uncertain phrases in brackets. Do not invent cultural context.` : "Set translation to an empty string.",
      `Story:\n${transcript}`,
    ].join("\n\n");
    const response = await fetch(`${endpoint}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt: instructions, format: "json", stream: false }),
    });
    if (!response.ok) throw new Error(`Ollama returned ${response.status}. Check that it is running and the model has been downloaded.`);
    const result = await response.json();
    const parsed = JSON.parse(result.response);
    if (typeof parsed.summary !== "string" || typeof parsed.translation !== "string" || !Array.isArray(parsed.themes)) {
      throw new Error("The model response didn't match the expected format. Try again or keep the story without AI help.");
    }
    $("#summary").value = parsed.summary.slice(0, 1200);
    if (parsed.translation) $("#translation").value = parsed.translation.slice(0, 4000);
    if (!$("#proverb").value && parsed.themes.length) {
      status.textContent = `Suggested themes: ${parsed.themes.filter((theme) => typeof theme === "string").slice(0, 5).join(", ")}. Verify every suggestion before keeping it.`;
    } else {
      status.textContent = "Summary ready. Check the original and translation before saving.";
    }
  } catch (error) {
    console.error("Local AI request failed:", error);
    const corsHint = error instanceof TypeError ? " The browser may need permission to connect to local Ollama; see the setup guide." : "";
    status.textContent = `${error.message || "The local AI request failed."}${corsHint}`;
    notify("Local AI wasn't available. Your story is still safe in the form.", true);
  } finally {
    button.disabled = false;
  }
}

async function saveStory(event) {
  event.preventDefault();
  const id = $("#story-id").value || crypto.randomUUID();
  const previous = stories.find((story) => story.id === id);
  const shouldKeepExistingAudio = audioSource === "existing" && currentAudio && previous?.audio && currentAudio === previous.audio;
  const story = {
    id,
    title: $("#story-title").value.trim(),
    storyteller: $("#storyteller").value.trim(),
    category: $("#category").value,
    language: $("#language").value.trim(),
    storyDate: $("#story-date").value,
    transcript: $("#transcript").value.trim(),
    proverb: $("#proverb").value.trim(),
    summary: $("#summary").value.trim(),
    translation: $("#translation").value.trim(),
    audio: shouldKeepExistingAudio ? previous.audio : currentAudio || null,
    updatedAt: new Date().toISOString(),
    createdAt: previous?.createdAt || new Date().toISOString(),
  };
  try {
    await storeStory(story);
    await refreshStories();
    storyDialog.close();
    resetForm();
    notify("Story kept safely on this device.");
  } catch (error) {
    console.error("Could not save story:", error);
    notify("Couldn't save this story. Check that this browser has available storage and try again.", true);
  }
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function dataUrlToBlob(dataUrl) {
  if (typeof dataUrl !== "string" || !/^data:audio\/[^;,]+;base64,/.test(dataUrl)) {
    throw new Error("A backup contains an invalid audio recording.");
  }
  const [header, encoded] = dataUrl.split(",", 2);
  const mimeType = header.slice(5, header.indexOf(";"));
  const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
  return new Blob([bytes], { type: mimeType });
}

async function exportArchive() {
  try {
    const backup = {
      format: "midzimu-archive",
      version: 1,
      exportedAt: new Date().toISOString(),
      stories: await Promise.all(stories.map(async (story) => ({
        ...story,
        audio: story.audio instanceof Blob ? await blobToDataUrl(story.audio) : null,
      }))),
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `midzimu-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    notify("Backup saved. Keep it somewhere private and safe.");
  } catch (error) {
    console.error("Could not export archive:", error);
    notify("Couldn't create a backup. Try again or check available storage.", true);
  }
}

async function importArchive(file) {
  if (!file) return;
  try {
    const backup = JSON.parse(await file.text());
    if (backup.format !== "midzimu-archive" || backup.version !== 1 || !Array.isArray(backup.stories)) {
      throw new Error("This file isn't a Midzimu archive backup.");
    }
    if (!window.confirm(`Import ${backup.stories.length} stories? Existing stories with matching IDs will be replaced.`)) return;
    for (const item of backup.stories) {
      if (typeof item.title !== "string" || typeof item.transcript !== "string" || typeof item.id !== "string") {
        throw new Error("The backup contains a story with missing required fields.");
      }
      const story = { ...item, audio: item.audio ? dataUrlToBlob(item.audio) : null };
      await storeStory(story);
    }
    await refreshStories();
    notify(`Imported ${backup.stories.length} ${backup.stories.length === 1 ? "story" : "stories"} to this device.`);
  } catch (error) {
    console.error("Could not import archive:", error);
    notify(error.message || "Couldn't import this backup.", true);
  } finally {
    $("#import-file").value = "";
  }
}

$("#new-story-button").addEventListener("click", () => openStoryEditor());
$("#story-form").addEventListener("submit", saveStory);
$("#record-button").addEventListener("click", toggleRecording);
$("#organize-button").addEventListener("click", organizeWithLocalAi);
$("#backup-button").addEventListener("click", () => {
  const choice = window.prompt("Type SAVE to export a backup, or IMPORT to restore one.");
  if (choice?.trim().toUpperCase() === "SAVE") exportArchive();
  else if (choice?.trim().toUpperCase() === "IMPORT") $("#import-file").click();
});
$("#import-file").addEventListener("change", (event) => importArchive(event.target.files[0]));
$("#search-input").addEventListener("input", renderStories);
$("#close-dialog").addEventListener("click", () => storyDialog.close());
$("#cancel-dialog").addEventListener("click", () => storyDialog.close());
$("#audio-file").addEventListener("change", (event) => {
  const file = event.target.files[0];
  if (!file) return;
  recording = null;
  setAudioPreview(file);
  $("#recording-status").textContent = `${file.name} selected. It will be saved with this story on this device.`;
});
$("#clear-audio").addEventListener("click", () => {
  recording = null;
  currentAudio = null;
  audioSource = "none";
  $("#audio-file").value = "";
  clearAudioPreview();
  $("#recording-status").textContent = "Recording removed.";
});
$(".filters").addEventListener("click", (event) => {
  const button = event.target.closest("[data-filter]");
  if (!button) return;
  activeFilter = button.dataset.filter;
  for (const chip of $(".filters").querySelectorAll(".filter-chip")) {
    const selected = chip === button;
    chip.classList.toggle("is-active", selected);
    chip.setAttribute("aria-pressed", String(selected));
  }
  renderStories();
});
$("#privacy-button").addEventListener("click", () => privacyDialog.showModal());
$("#close-privacy").addEventListener("click", () => privacyDialog.close());
$("#privacy-done").addEventListener("click", () => privacyDialog.close());
storyDialog.addEventListener("close", resetForm);
window.addEventListener("beforeunload", () => {
  stopRecording();
  revokeObjectUrls();
});

try {
  await refreshStories();
} catch (error) {
  console.error("Could not open the local archive:", error);
  storyList.replaceChildren(makeElement("p", "empty-state", "Your browser couldn't open local storage. Try another up-to-date browser or a private window with storage enabled."));
  notify("Couldn't open the archive on this device.", true);
}

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("./sw.js").catch((error) => console.error("Offline caching isn't available:", error));
}
