import type { RouteObject } from 'react-router'
import { createBrowserRouter, Navigate } from 'react-router'
import { AppLayout } from '@/components/AppLayout'
import { RouteError } from '@/components/RouteError'
import { RequireAuth } from '@/features/auth/RequireAuth'
import { AddEntryPage } from '@/pages/AddEntryPage'
import { HierarchyPage } from '@/pages/HierarchyPage'
import { LoginPage } from '@/pages/LoginPage'
import { TaskEntriesPage } from '@/pages/TaskEntriesPage'

export const routes: RouteObject[] = [
  {
    // Pathless root so a crash in any route, layout or guard shows our screen.
    errorElement: <RouteError />,
    children: [
      { path: '/login', element: <LoginPage /> },
      {
        element: <RequireAuth />,
        children: [
          {
            element: <AppLayout />,
            children: [
              { path: '/', element: <HierarchyPage /> },
              // Old task links keep working.
              {
                path: '/tasks/:taskId',
                element: <Navigate to="entries" replace />,
              },
              { path: '/tasks/:taskId/entries', element: <TaskEntriesPage /> },
              { path: '/tasks/:taskId/entries/new', element: <AddEntryPage /> },
            ],
          },
        ],
      },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]

export const router = createBrowserRouter(routes)
