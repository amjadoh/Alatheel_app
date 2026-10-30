// Only vite.qa.config.ts aliases the FeedbackPanel import to this boundary.
import { feedbackListeners, feedbackNotes } from "./app-service";
export const collection = (...args: any[]) => args;
export const query = (...args: any[]) => args;
export const limit = (...args: any[]) => args;
export const orderBy = (...args: any[]) => args;
export const where = (...args: any[]) => args;
export function onSnapshot(_: any, next: any) {
  const emit = () =>
    next({
      docs: feedbackNotes().map((note) => ({
        id: note.id,
        data: () => ({ ...note }),
      })),
    });
  feedbackListeners.add(emit);
  emit();
  return () => feedbackListeners.delete(emit);
}
