import * as React from 'react';
import { render, act } from '@testing-library/react';
import { ForeignComponentContainer } from './ForeignComponentContainer';

function resolveAfter(time = 5) {
  return new Promise<void>((resolve) => setTimeout(resolve, time));
}

describe('ForeignComponentContainer component', () => {
  it('mounts an HTML component', async () => {
    const mount = jest.fn();
    const component = { mount };
    const container = render(
      <ForeignComponentContainer $component={component} $context={undefined} $portalId="foo" innerProps={{}} />,
    );
    await act(resolveAfter);
    expect(mount).toHaveBeenCalled();
    container.unmount();
  });

  it('unmounts an HTML component', async () => {
    const mount = jest.fn();
    const unmount = jest.fn();
    const component = { mount, unmount };
    const container = render(
      <ForeignComponentContainer $component={component} $context={undefined} $portalId="foo" innerProps={{}} />,
    );
    await act(resolveAfter);
    expect(mount).toHaveBeenCalled();
    expect(unmount).not.toHaveBeenCalled();
    container.unmount();
    expect(unmount).toHaveBeenCalled();
  });

  it('updates an HTML component', async () => {
    const mount = jest.fn();
    const update = jest.fn();
    const component = { mount, update };
    const container = render(
      <ForeignComponentContainer
        $component={component}
        $context={undefined}
        $portalId="foo"
        innerProps={{ a: 'bar' }}
      />,
    );
    await act(resolveAfter);
    expect(mount).toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    container.rerender(
      <ForeignComponentContainer
        $component={component}
        $context={undefined}
        $portalId="foo"
        innerProps={{ a: 'foo' }}
      />,
    );
    await act(resolveAfter);
    expect(update).toHaveBeenCalled();
    container.unmount();
  });

  it('forces re-rendering of an HTML component', async () => {
    const componentDidMount = ForeignComponentContainer.prototype.componentDidMount;
    ForeignComponentContainer.prototype.componentDidMount = function () {
      componentDidMount.call(this);
      this.previous = {
        removeEventListener() {},
      };
    };
    const mount = jest.fn();
    const update = jest.fn();
    const unmount = jest.fn();
    const component = { mount, update, unmount };
    const container = render(
      <ForeignComponentContainer
        $component={component}
        $context={undefined}
        $portalId="foo"
        innerProps={{ a: 'bar' }}
      />,
    );
    await act(resolveAfter);
    expect(mount).toHaveBeenCalled();
    expect(unmount).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    container.rerender(
      <ForeignComponentContainer
        $component={component}
        $context={undefined}
        $portalId="foo"
        innerProps={{ a: 'foo' }}
      />,
    );
    await act(resolveAfter);
    expect(update).not.toHaveBeenCalled();
    expect(unmount).toHaveBeenCalled();
    container.unmount();
  });

  it('listens to render-html', async () => {
    const mount = jest.fn();
    const renderHtmlExtension = jest.fn();
    const component = { mount };
    const props = { piral: { renderHtmlExtension }, meta: {} };
    const container = render(
      <ForeignComponentContainer $component={component} $context={undefined} $portalId="foo" innerProps={props} />,
    );
    await act(resolveAfter);
    expect(mount).toHaveBeenCalled();
    const node = document.querySelector('[data-portal-id=foo]');
    expect(renderHtmlExtension).not.toHaveBeenCalled();
    node?.dispatchEvent(new CustomEvent('render-html', { detail: {} }));
    await act(resolveAfter);
    expect(renderHtmlExtension).toHaveBeenCalled();
    container.unmount();
  });
});
