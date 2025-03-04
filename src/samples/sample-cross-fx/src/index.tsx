// @ts-nocheck
import 'core-js/es/reflect';
import 'core-js/stable/reflect';
import 'core-js/features/reflect';
import 'zone.js/dist/zone.js';
import '@webcomponents/webcomponentsjs/webcomponents-loader';
import '@webcomponents/webcomponentsjs/webcomponents-bundle.js';
import '@webcomponents/webcomponentsjs/custom-elements-es5-adapter';

import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { createInstance, LayoutProps, LoadingIndicatorProps, Piral, SetComponent, SetRoute } from 'piral-core';
import { createVueApi } from 'piral-vue';
import { createNgApi } from 'piral-ng';
import { createNgjsApi } from 'piral-ngjs';
import { createHyperappApi } from 'piral-hyperapp';
import { createInfernoApi } from 'piral-inferno';
import { createPreactApi } from 'piral-preact';
import { createLazyApi } from 'piral-lazy';
import { createLitElApi } from 'piral-litel';
import { createMithrilApi } from 'piral-mithril';
import { createAureliaApi } from 'piral-aurelia';
import { createRiotApi } from 'piral-riot';
import { createElmApi } from 'piral-elm';
import { createSvelteApi } from 'piral-svelte';
import { createBlazorApi } from 'piral-blazor';
import { createSolidApi } from 'piral-solid';
import { createDashboardApi, Dashboard, DashboardContainerProps } from 'piral-dashboard';

const Loader: React.FC<LoadingIndicatorProps> = () => (
  <div className="app-center">
    <div className="spinner circles">Loading ...</div>
  </div>
);

const DashboardContainer: React.FC<DashboardContainerProps> = ({ children }) => <div className="tiles">{children}</div>;

const Layout: React.FC<LayoutProps> = ({ children }) => (
  <div className="app-container">
    <div className="app-header">
      <h1>Cross Framework Sample</h1>
    </div>
    <div className="app-content">{children}</div>
    <div className="app-footer">
      For more information or the source code check out our{' '}
      <a href="https://github.com/smapiot/piral">GitHub repository</a>.
    </div>
  </div>
);

const instance = createInstance({
  plugins: [
    createLazyApi(),
    createVueApi(),
    createNgApi(),
    createNgjsApi(),
    createHyperappApi(),
    createInfernoApi(),
    createPreactApi(),
    createLitElApi(),
    createMithrilApi(),
    createAureliaApi(),
    createRiotApi(),
    createElmApi(),
    createSvelteApi(),
    createBlazorApi(),
    createSolidApi(),
    createDashboardApi(),
  ],
  requestPilets() {
    return fetch('https://feed.piral.cloud/api/v1/pilet/cross-fx')
      .then((res) => res.json())
      .then((res) => res.items);
  },
});

const root = createRoot(document.querySelector('#app'));
root.render(
  <Piral instance={instance}>
    <SetComponent name="LoadingIndicator" component={Loader} />
    <SetComponent name="Layout" component={Layout} />
    <SetComponent name="DashboardContainer" component={DashboardContainer} />
    <SetRoute path="/" component={Dashboard} />
  </Piral>,
);
