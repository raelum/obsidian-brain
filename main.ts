// How to develop
// - Navigate to .plugins/obsidian-brain folder
// - npm run dev
// - Change code and it should rebuild, triggering hot reload on Obsidian

import { Editor, EditorChange, EditorPosition, Plugin } from 'obsidian';

export default class ObsidianBrain extends Plugin {
  async onload() {
    this.addCommand({
      id: 'complete-task',
      name: 'Complete Task',
      editorCallback: (editor: Editor) => {
        archiveTask(editor, ArchiveTaskMode.Complete);
      }
    });

    this.addCommand({
      id: 'progress-task',
      name: 'Progress Task',
      editorCallback: (editor: Editor) => {
        archiveTask(editor, ArchiveTaskMode.Progress);
      }
    });

    this.addCommand({
      id: 'delete-task',
      name: 'Delete Task',
      editorCallback: (editor: Editor) => {
        archiveTask(editor, ArchiveTaskMode.Delete);
      }
    });
  }
}

class Task {
  parents: string[];
  task: string;
  children: string[];
  // Regex that matches a bullet task syntax "- [ ] " while capturing
  // the leading whitespaces as a group to insert into the final output.
  // (\s*) is capturing the white spaces, and $1 uses the captured value.
  bulletTaskRegex: RegExp = /^(\s*)- \[ \]/;

  constructor(parents: string[], task: string, children: string[]) {
    // Convert parent tasks to regular bullet points
    this.parents = parents.map((p) => { return p.replace(this.bulletTaskRegex, "$1-") });
    this.task = task;
    this.children = children;
  }

  // Mark the task as completed.
  markAsCompleted(): void {
    this.replaceTaskAndChildrenBullet("$1- [x]");
  }

  // Mark the task as in progress.
  markAsInProgress(): void {
    this.replaceTaskAndChildrenBullet("$1- [/]");
  }

  // Print out the current task including only parents after the give includeParentIndex.
  toString(includeParentIndex: number): string {
    return [...this.parents.slice(includeParentIndex), this.task, ...this.children].join("\n");
  }

  private replaceTaskAndChildrenBullet(replaceValue: string) {
    this.task = this.task.replace(this.bulletTaskRegex, replaceValue);
    this.children = this.children.map((c) => { return c.replace(this.bulletTaskRegex, replaceValue) });
  }
}

class Markdown {
  editor: Editor;
  changes: EditorChange[];

  constructor(editor: Editor) {
    this.editor = editor;
    this.changes = [];
  }

  // Checks if the given line is a task.
  isBullet(lineNumber: number): boolean {
    // TODO: Replace this with regex match
    return lineNumber <= this.editor.lastLine() && this.editor.getLine(lineNumber).contains("- ");
  }

  // Checks if the given line is a task.
  isBulletTask(lineNumber: number): boolean {
    // TODO: Replace this with regex match
    return lineNumber <= this.editor.lastLine() &&
      (this.editor.getLine(lineNumber).contains("- [ ] ") || this.editor.getLine(lineNumber).contains("- [x] "));
  }

  isArchiveTask(lineNumber: number): boolean {
    return this.isBullet(lineNumber) || this.isBulletTask(lineNumber);
  }

  // Returns the indent level of the given line.
  indentLevel(lineNumber: number): number {
    const match = this.editor.getLine(lineNumber).match(/^\t*/);
    return match ? match[0].length : 0;
  }

  // Gets a Task object for the given line.
  getTask(lineNumber: number): Task | null {
    if (!this.isBulletTask(lineNumber)) {
      return null;
    }

    // Get the current task.
    var task: string = this.editor.getLine(lineNumber);
    var taskIndentLevel: number = this.indentLevel(lineNumber);

    // Get the current task's parents.
    var parents: string[] = [];
    var parentLineNumber = lineNumber - 1;
    var currentIndentLevel = taskIndentLevel;
    for (var parentIndentLevel = taskIndentLevel - 1; parentIndentLevel >= 0; parentIndentLevel--) {
      // Iterate once for every parent we want to find.
      while (parentLineNumber >= 0 && this.indentLevel(parentLineNumber) >= currentIndentLevel) {
        // Keep iterating until we find a line that has a lower indent level than the current task.
        parentLineNumber--;
      }
      if (parentLineNumber >= 0 &&
        this.isBulletTask(parentLineNumber) &&
        this.indentLevel(parentLineNumber) == parentIndentLevel) {
        currentIndentLevel = parentIndentLevel;
        // Since we're iterating over parents backwards, add them to the front of the list.
        parents.unshift(this.editor.getLine(parentLineNumber));
      } else {
        // Either we reached the beginning of the file, the current line is a task, or we saw an unexpected indent level
        // indicating a malformed task list. Abort finding parents.
        break;
      }
    }

    // Get the current task's children.
    var children: string[] = [];
    var childLineNumber = lineNumber + 1;
    var childIndentLevel = taskIndentLevel + 1;
    while (childLineNumber <= this.editor.lastLine() && this.indentLevel(childLineNumber) >= childIndentLevel) {
      children.push(this.editor.getLine(childLineNumber));
      childLineNumber++;
    }

    return new Task(parents, task, children);
  }

  appendAfterLine(lineNumber: number, text: string) {
    this.changes.push({ text: "\n" + text, from: this.lineEndPosition(lineNumber) });
  }

  // Appends the given text to the end of the file starting from a new line.
  appendToEnd(text: string): void {
    this.appendAfterLine(this.editor.lastLine(), text);
  }

  replaceLine(lineNumber: number, text: string) {
    this.changes.push({ text: text, from: this.lineStartPosition(lineNumber), to: this.lineEndPosition(lineNumber) });
  }

  // Delete the given line range. If a range isn't given, it defaults to deleting one line.
  deleteLine(fromLine: number, toLine?: number) {
    var startPosition: EditorPosition = this.lineStartPosition(fromLine);
    var endPosition: EditorPosition = this.lineStartPosition(toLine == undefined ? fromLine + 1 : toLine + 1);
    this.changes.push({ text: "", from: startPosition, to: endPosition });
  }

  // Apply all changes as 1 transaction so that command + z undos all of them together.
  applyChanges(): void {
    this.editor.transaction({ changes: this.changes });
  }

  lineStartPosition(lineNumber: number): EditorPosition {
    return { line: lineNumber, ch: 0 };
  }

  lineEndPosition(lineNumber: number): EditorPosition {
    return { line: lineNumber, ch: this.editor.getLine(lineNumber).length };
  }
}

// Gets today's date in YYYY-MM-DD format.
function getLocalDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Removes any surrounding whitespace or preceding bullet/task markings so we can
// just see the task description.
function stripTask(task: string): string {
  // Remove any surrounding whitespaces since tasks can be indented.
  task = task.trim();

  // Define the preceding patterns to be removed.
  const patterns = ["- [ ] ", "- [x] ", "- [/] ", "- "];

  // Remove any pattern found at the beginning of the string.
  for (const pattern of patterns) {
    if (task.startsWith(pattern)) {
      return task.slice(pattern.length);
    }
  }
  return task;
}

// Compares 2 tasks by first removing any preceding checkbox, bullet points, or spaces.
function isSameTask(task1: string, task2: string): boolean {
  return stripTask(task1) == stripTask(task2);
}

enum ArchiveTaskMode {
  Complete,
  Progress,
  Delete
}

function archiveTask(editor: Editor, mode: ArchiveTaskMode): void {
  // Get current line information.
  var taskLineNumber: number = editor.getCursor().line;
  var md: Markdown = new Markdown(editor);

  // Don't do anything if current line isn't a task.
  if (!md.isBulletTask(taskLineNumber)) {
    return;
  }

  var taskResult: Task | null = md.getTask(taskLineNumber);
  if (taskResult == null) {
    return;
  }
  var task: Task = taskResult as Task;
  var numberOfChildren = task.children.length;
  if (mode == ArchiveTaskMode.Complete) {
    task.markAsCompleted();
  } else if (mode == ArchiveTaskMode.Progress) {
    task.markAsInProgress();
  }

  if (mode != ArchiveTaskMode.Delete) {
    // Find history section.
    var historyLineNumber: number = -1;
    for (var i = taskLineNumber + 1; i < editor.lineCount(); i++) {
      var line = editor.getLine(i);
      if (line == "# History") {
        historyLineNumber = i;
        break;
      }
    }

    // Create history section if it doesn't exist.
    if (historyLineNumber == -1) {
      md.appendToEnd("# History");
      historyLineNumber = editor.lineCount();
    }

    // Find today section.
    let today = getLocalDateString();
    var todayLineNumber = -1;
    for (var i = historyLineNumber + 1; i < editor.lineCount(); i++) {
      var line = editor.getLine(i);
      if (line == "## " + today) {
        todayLineNumber = i;
        break;
      }
    }

    // Create today subsection if it doesn't exist.
    var createdTodaySection = false;
    if (todayLineNumber == -1) {
      md.appendAfterLine(historyLineNumber, "## " + today);
      // We appended the section but it doesn't truly exist until changes are applied. For all intents and purposes, the
      // true line number for today section is same as history section since it's being inserted at that spot.
      todayLineNumber = historyLineNumber;
      createdTodaySection = true;
    }

    if (createdTodaySection) {
      // Today section was just created, so we can insert the task without performing a search.
      md.appendAfterLine(todayLineNumber, task.toString(0));
    } else {
      // Today section already exists, so search for the point at which we can merge the current task into
      // the history list. A task can have multiple parents that may or or may exist in the history list so
      // we eagerly search for matching parents until we cannot find anymore.
      var archiveTaskLineNumber = todayLineNumber + 1;
      var currentParentLevel = 0;
      for (; currentParentLevel < task.parents.length; currentParentLevel++) {
        while (md.isArchiveTask(archiveTaskLineNumber) &&
          // Either the current task is a subtask compared to the parent.
          (md.indentLevel(archiveTaskLineNumber) > currentParentLevel ||
            // Or the current task is a sibling of the parent, but not a match yet.
            (md.indentLevel(archiveTaskLineNumber) == currentParentLevel &&
              !isSameTask(editor.getLine(archiveTaskLineNumber), task.parents[currentParentLevel])))) {
          archiveTaskLineNumber++;
        }
        if (!md.isArchiveTask(archiveTaskLineNumber) || md.indentLevel(archiveTaskLineNumber) < currentParentLevel) {
          // We reached the end of the task (or subtask) list.
          break;
        } else if (md.indentLevel(archiveTaskLineNumber) == currentParentLevel &&
          isSameTask(editor.getLine(archiveTaskLineNumber), task.parents[currentParentLevel])) {
          // We reached the matching parent task.
          archiveTaskLineNumber++;

        }
      }

      // We've found the spot at which we can merge the remaining parents (if any) and current task.
      // Iterate to the end of the current (sub)list to find the spot we can insert our current task.
      while (md.isArchiveTask(archiveTaskLineNumber) && md.indentLevel(archiveTaskLineNumber) >= currentParentLevel) {
        // Exit early if we manage to find the current task.
        if (md.indentLevel(archiveTaskLineNumber) == currentParentLevel &&
          isSameTask(editor.getLine(archiveTaskLineNumber), task.task)) {
          break;
        }
        archiveTaskLineNumber++;
      }

      if (md.indentLevel(archiveTaskLineNumber) == currentParentLevel &&
        isSameTask(editor.getLine(archiveTaskLineNumber), task.task)) {
        // We just found the target task in the history list. Replace it with the current intended bullet type.
        md.replaceLine(archiveTaskLineNumber, task.task);
        // Add any children to the end of the list.
        //
        // TODO: Consider properly merging the existing archive task list and current task list. This is significant
        // amount of work that I currently don't think is worth the hassle considering how rarely I encounter this case.
        if (task.children.length > 0) {
          archiveTaskLineNumber++;
          while (md.isArchiveTask(archiveTaskLineNumber) && md.indentLevel(archiveTaskLineNumber) >= currentParentLevel + 1) {
            archiveTaskLineNumber++;
          }
          md.appendAfterLine(archiveTaskLineNumber - 1, task.children.join("\n"));
        }
      } else {
        // Add task to list under section.
        md.appendAfterLine(archiveTaskLineNumber - 1, task.toString(currentParentLevel));
      }
    }
  }

  // Delete task only if the user is marking the task as fully completed or deleting it.
  // NOTE: We do this at the end since deleted lines impacts line numbers of other changes.
  if (mode == ArchiveTaskMode.Complete || mode == ArchiveTaskMode.Delete) {
    md.deleteLine(taskLineNumber, taskLineNumber + numberOfChildren);
  }

  // Apply all changes as 1 transaction so that command + z undos all of them together.
  md.applyChanges();

  // Place cursor on the last character of the next task after completion.
  if (mode == ArchiveTaskMode.Complete || mode == ArchiveTaskMode.Delete) {
    editor.setCursor(md.lineEndPosition(taskLineNumber));
  }
}