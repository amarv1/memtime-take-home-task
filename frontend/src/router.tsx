import type { RouteObject } from 'react-router'
import { createBrowserRouter, Navigate } from 'react-router'
import { AppLayout } from '@/components/AppLayout'
import { RouteError } from '@/components/RouteError'
import { RequireAuth } from '@/features/auth/RequireAuth'
import { HierarchyPage } from '@/pages/HierarchyPage'
import { LoginPage } from '@/pages/LoginPage'

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
              { path: '/tasks/:taskId', element: <HierarchyPage /> },
            ],
          },
        ],
      },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]

export const router = createBrowserRouter(routes)
