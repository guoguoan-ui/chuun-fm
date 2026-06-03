/**
 * QUEUE.js — 播放队列管理
 * 跟踪当前播放、下一首、历史
 */
const stateDB = require('./STATE.DB');

let queue = [];
let history = [];
let currentIndex = -1;

function init() {
  queue = stateDB.getQueue() || [];
  currentIndex = queue.length > 0 ? 0 : -1;
}

function setQueue(songs) {
  queue = songs || [];
  currentIndex = queue.length > 0 ? 0 : -1;
  stateDB.setQueue(queue);
}

function getCurrent() {
  if (currentIndex < 0 || currentIndex >= queue.length) return null;
  return queue[currentIndex];
}

function getUpNext() {
  const nextIdx = currentIndex + 1;
  if (nextIdx < queue.length) return queue[nextIdx];
  return null;
}

function advance() {
  if (queue.length === 0) return null;
  // 记录历史
  if (currentIndex >= 0 && currentIndex < queue.length) {
    history.push(queue[currentIndex]);
  }
  currentIndex++;
  if (currentIndex >= queue.length) {
    currentIndex = -1;
    queue = [];
    return null;
  }
  return queue[currentIndex];
}

function skipTo(index) {
  if (index < 0 || index >= queue.length) return null;
  if (currentIndex >= 0 && currentIndex < queue.length) {
    history.push(queue[currentIndex]);
  }
  currentIndex = index;
  return queue[currentIndex];
}

function addToQueue(songs) {
  queue.push(...songs);
  if (currentIndex < 0 && queue.length > 0) currentIndex = 0;
  stateDB.setQueue(queue);
}

function clear() {
  queue = [];
  history = [];
  currentIndex = -1;
  stateDB.setQueue([]);
}

function getQueue() { return queue; }
function getHistory() { return history.slice(-20); }

module.exports = { init, setQueue, getCurrent, getUpNext, advance, skipTo, addToQueue, clear, getQueue, getHistory };
