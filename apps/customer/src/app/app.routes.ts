import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', pathMatch: 'full', loadComponent: () => import('./home.page').then((m) => m.HomePage) },
  { path: 'status', loadComponent: () => import('./status.page').then((m) => m.StatusPage) },
  { path: '**', redirectTo: '' },
];
