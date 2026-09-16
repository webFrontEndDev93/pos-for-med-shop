export type Route = 'billing' | 'inventory' | 'customers' | 'reports' | 'settings';

export const ROUTES: Route[] = ['billing', 'inventory', 'customers', 'reports', 'settings'];

export const ROUTE_TITLES: Record<Route, string> = {
  billing: 'Billing counter',
  inventory: 'Inventory',
  customers: 'Customers',
  reports: 'Reports',
  settings: 'Settings',
};

export function routeFromHash(): Route {
  const hash = window.location.hash.replace('#/', '') as Route;
  return ROUTES.includes(hash) ? hash : 'billing';
}
