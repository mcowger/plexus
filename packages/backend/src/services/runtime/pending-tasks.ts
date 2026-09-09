/** Tracks already-started work so shutdown can wait for its side effects. */
export class PendingTasks {
  private readonly tasks = new Set<Promise<unknown>>();

  track<T>(task: Promise<T>): Promise<T> {
    this.tasks.add(task);
    void task.then(
      () => this.tasks.delete(task),
      () => this.tasks.delete(task)
    );
    return task;
  }

  async drain(): Promise<void> {
    while (this.tasks.size > 0) {
      await Promise.allSettled([...this.tasks]);
    }
  }
}
