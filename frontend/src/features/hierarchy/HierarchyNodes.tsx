import { memo, useCallback } from 'react'
import { useProjects, useTasks, hierarchyKeys } from './hooks'
import type { Client, Project, Task } from './api'
import { NodeList } from './NodeList'
import { StatusBadge } from './StatusBadge'
import { TreeItem } from './TreeItem'
import { childKey, useTree, useTreeSelector } from './treeContext'

// Rows are memoized and read tree state through selectors, so a row renders again only
// when its own item or its own flags change.
export const ClientItem = memo(function ClientItem({ client }: { client: Client }) {
  const nodeKey = `client:${client.id}`
  const ancestor = useTreeSelector((s) => s.target?.clientId === client.id)
  return (
    <TreeItem
      level={1}
      nodeKey={nodeKey}
      ancestor={ancestor}
      name={client.name}
      childrenQueryKey={hierarchyKeys.projects(client.id)}
      details={<StatusBadge status={client.status} />}
    >
      <ProjectRows clientId={client.id} parentKey={nodeKey} />
    </TreeItem>
  )
})

// Mounted only while the client is expanded, which is what makes the fetch lazy.
function ProjectRows({ clientId, parentKey }: { clientId: number; parentKey: string }) {
  const query = useProjects(clientId)
  const targetId = useTreeSelector((s) =>
    s.target?.clientId === clientId ? s.target.projectId : undefined,
  )
  return (
    <NodeList
      query={query}
      targetId={targetId}
      level={2}
      parentKey={parentKey}
      noun="projects"
      render={(project) => (
        <ProjectItem
          key={project.id}
          project={project}
          nodeKey={childKey(parentKey, `project:${project.id}`)}
        />
      )}
    />
  )
}

const ProjectItem = memo(function ProjectItem({
  project,
  nodeKey,
}: {
  project: Project
  nodeKey: string
}) {
  const ancestor = useTreeSelector((s) => s.target?.projectId === project.id)
  return (
    <TreeItem
      level={2}
      nodeKey={nodeKey}
      ancestor={ancestor}
      name={project.name}
      childrenQueryKey={hierarchyKeys.tasks(project.id)}
      details={<StatusBadge status={project.status} />}
    >
      <TaskRows projectId={project.id} parentKey={nodeKey} />
    </TreeItem>
  )
})

function TaskRows({ projectId, parentKey }: { projectId: number; parentKey: string }) {
  const query = useTasks(projectId)
  const targetId = useTreeSelector((s) =>
    s.target?.projectId === projectId ? s.target.taskId : undefined,
  )
  return (
    <NodeList
      query={query}
      targetId={targetId}
      level={3}
      parentKey={parentKey}
      noun="tasks"
      render={(task) => (
        <TaskItem
          key={task.id}
          task={task}
          nodeKey={childKey(parentKey, `task:${task.id}`)}
        />
      )}
    />
  )
}

const TaskItem = memo(function TaskItem({
  task,
  nodeKey,
}: {
  task: Task
  nodeKey: string
}) {
  const { selectTask } = useTree()
  const selected = useTreeSelector((s) => s.selectedTaskId === task.id)
  const onSelect = useCallback(() => selectTask(task.id), [selectTask, task.id])
  return (
    <TreeItem
      level={3}
      nodeKey={nodeKey}
      name={task.name}
      selected={selected}
      onSelect={onSelect}
      details={
        <>
          <span className="shrink-0 text-xs text-muted-foreground">#{task.id}</span>
          <StatusBadge status={task.status} />
        </>
      }
    />
  )
})
