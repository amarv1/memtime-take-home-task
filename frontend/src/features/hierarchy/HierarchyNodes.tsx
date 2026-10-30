import { useProjects, useTasks, hierarchyKeys } from './hooks'
import type { Client, Project, Task } from './api'
import { NodeList } from './NodeList'
import { StatusBadge } from './StatusBadge'
import { TreeItem } from './TreeItem'
import { childKey, useTree } from './treeContext'

export function ClientItem({ client }: { client: Client }) {
  const nodeKey = `client:${client.id}`
  const { target } = useTree()
  return (
    <TreeItem
      level={1}
      nodeKey={nodeKey}
      ancestor={target?.clientId === client.id}
      name={client.name}
      childrenQueryKey={hierarchyKeys.projects(client.id)}
      details={<StatusBadge status={client.status} />}
    >
      <ProjectRows clientId={client.id} parentKey={nodeKey} />
    </TreeItem>
  )
}

// Mounted only while the client is expanded, which is what makes the fetch lazy.
function ProjectRows({ clientId, parentKey }: { clientId: number; parentKey: string }) {
  const query = useProjects(clientId)
  const { target } = useTree()
  return (
    <NodeList
      query={query}
      targetId={target?.clientId === clientId ? target.projectId : undefined}
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

function ProjectItem({ project, nodeKey }: { project: Project; nodeKey: string }) {
  const { target } = useTree()
  return (
    <TreeItem
      level={2}
      nodeKey={nodeKey}
      ancestor={target?.projectId === project.id}
      name={project.name}
      childrenQueryKey={hierarchyKeys.tasks(project.id)}
      details={<StatusBadge status={project.status} />}
    >
      <TaskRows projectId={project.id} parentKey={nodeKey} />
    </TreeItem>
  )
}

function TaskRows({ projectId, parentKey }: { projectId: number; parentKey: string }) {
  const query = useTasks(projectId)
  const { target } = useTree()
  return (
    <NodeList
      query={query}
      targetId={target?.projectId === projectId ? target.taskId : undefined}
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

function TaskItem({ task, nodeKey }: { task: Task; nodeKey: string }) {
  const { selectedTaskId, selectTask } = useTree()
  return (
    <TreeItem
      level={3}
      nodeKey={nodeKey}
      name={task.name}
      selected={selectedTaskId === task.id}
      onSelect={() => selectTask(task.id)}
      details={
        <>
          <span className="shrink-0 text-xs text-muted-foreground">#{task.id}</span>
          <StatusBadge status={task.status} />
        </>
      }
    />
  )
}
