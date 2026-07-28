import type {
  DesktopRunEvent
} from '../contracts';

export interface DesktopBudgetProgress {
  pageNumber:
    number;
  pageBudget:
    number;
  navigationUsed:
    number;
  navigationBudget:
    number;
}

export function reduceDesktopBudgetProgress(
  progress:
    DesktopBudgetProgress | null,
  event:
    DesktopRunEvent
): DesktopBudgetProgress | null {
  switch (
    event.type
  ) {
    case 'run-started':
      return {
        pageNumber:
          0,
        pageBudget:
          event.pageBudget,
        navigationUsed:
          0,
        navigationBudget:
          event.navigationBudget
      };

    case 'inspection-started':
      return progress ===
        null
        ? null
        : {
            ...progress,
            pageNumber:
              event.pageNumber
          };

    case 'navigation-started':
      return progress ===
        null
        ? null
        : {
            ...progress,
            navigationUsed:
              event
                .navigationStep
          };

    default:
      return progress;
  }
}
