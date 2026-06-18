import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./tabs/tabs.page').then(m => m.TabsPage),
    children: [
      {
        path: 'scanner',
        loadComponent: () => import('./features/scanner/scanner.page').then(m => m.ScannerPage),
      },
      {
        path: 'catalog',
        children: [
          {
            path: '',
            loadComponent: () => import('./features/catalog/catalog.page').then(m => m.CatalogPage),
          },
          {
            path: ':id',
            loadComponent: () => import('./features/product-detail/product-detail.page').then(m => m.ProductDetailPage),
          },
        ],
      },
      {
        path: 'quote',
        loadComponent: () => import('./features/quote/quote.page').then(m => m.QuotePage),
      },
      {
        path: 'account',
        loadComponent: () => import('./features/account/account.page').then(m => m.AccountPage),
      },
      {
        path: '',
        redirectTo: 'scanner',
        pathMatch: 'full',
      },
    ],
  },
];
