"use client";

import {useRouter} from 'next/navigation';
import {RouterProvider, I18nProvider} from 'react-aria-components';

// Configure the type of the `routerOptions` prop on all React Aria components.
declare module 'react-aria-components' {
  interface RouterConfig {
    routerOptions: NonNullable<Parameters<ReturnType<typeof useRouter>['push']>[1]>
  }
}

export function ClientProviders({lang, children}) {
  let router = useRouter();

  return (
    <I18nProvider locale={lang}>
      <RouterProvider navigate={router.push}>
        {children}
      </RouterProvider>
    </I18nProvider>
  );
}