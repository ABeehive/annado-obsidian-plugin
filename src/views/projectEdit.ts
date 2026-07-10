// The project picker in the edit sheet edits only the task's PRIMARY project.
// Secondary projects (extra [[wikilinks]] in the title) must survive an edit
// untouched — dropping them from task.projects makes the serializer strip
// their wikilinks from the markdown line.

/** New projects array after the picker chose `selectedPrimary` ('' = none). */
export function mergeEditedProjects(original: string[], selectedPrimary: string): string[] {
  const tail = original.slice(1).filter((p) => p !== selectedPrimary);
  return selectedPrimary === '' ? tail : [selectedPrimary, ...tail];
}
