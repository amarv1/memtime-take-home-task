import { AlertCircle, Loader2, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPrimitive,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { ApiError } from '@/lib/api'
import { withWait } from '@/lib/rateLimit'
import type { TimeEntry } from './api'
import { useDeleteEntry } from './hooks'

/** A Delete button that asks first, since a deleted entry can't be brought back. */
export function DeleteEntryButton({ entry }: { entry: TimeEntry }) {
  const [open, setOpen] = useState(false)
  const remove = useDeleteEntry(entry.taskId)

  function confirm() {
    remove.mutate(entry.id, {
      onSuccess: () => {
        setOpen(false)
        toast.success(`Time entry #${entry.id} deleted`)
      },
    })
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        // Closing mid-request would hide the outcome.
        if (remove.isPending) return
        setOpen(next)
        if (!next) remove.reset()
      }}
    >
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="xs"
          className="text-destructive"
          aria-label={`Delete entry ${entry.id}`}
        >
          <Trash2 aria-hidden />
          Delete
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete time entry #{entry.id}?</AlertDialogTitle>
          <AlertDialogDescription>
            “{entry.comment}” will be removed for good. This can't be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {remove.isError && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive"
          >
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p>{errorMessage(remove.error)}</p>
          </div>
        )}

        <AlertDialogFooter>
          <AlertDialogPrimitive.Cancel asChild>
            <Button variant="outline" disabled={remove.isPending}>
              Cancel
            </Button>
          </AlertDialogPrimitive.Cancel>
          <Button variant="destructive" onClick={confirm} disabled={remove.isPending}>
            {remove.isPending ? (
              <>
                <Loader2 className="animate-spin" aria-hidden />
                Deleting…
              </>
            ) : (
              'Delete'
            )}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function errorMessage(error: Error): string {
  if (error instanceof ApiError) {
    if (error.status === 404) return "This time entry doesn't exist any more."
    if (error.status === 429) return withWait(error)
    if (error.status === 0) return error.message
  }
  return "Couldn't delete the time entry. Please try again."
}
