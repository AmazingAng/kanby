export type TaskOwner = {
  id: string;
  login: string;
  name: string;
  avatarUrl: string | null;
};

export function taskOwners(task: {
  owner: TaskOwner;
  owners?: TaskOwner[];
}): TaskOwner[] {
  return task.owners?.length ? task.owners : [task.owner];
}

export function taskMatchesMember(
  task: { owner: TaskOwner; owners?: TaskOwner[] },
  memberId: string,
) {
  return taskOwners(task).some((owner) => owner.id === memberId);
}

export function toggleTaskOwnerIds(current: string[], memberId: string) {
  if (current.includes(memberId))
    return current.length === 1
      ? current
      : current.filter((ownerId) => ownerId !== memberId);
  return current.length >= 3 ? current : [...current, memberId];
}
