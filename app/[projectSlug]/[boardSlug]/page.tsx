import { KanbanApp } from '@/components/kanban-app';

export default async function ProjectBoardPage({
  params,
}: {
  params: Promise<{ projectSlug: string; boardSlug: string }>;
}) {
  const { projectSlug, boardSlug } = await params;
  return (
    <KanbanApp
      mode="app"
      initialProjectSlug={
        boardSlug === 'board' ? projectSlug : '__invalid_board__'
      }
    />
  );
}
