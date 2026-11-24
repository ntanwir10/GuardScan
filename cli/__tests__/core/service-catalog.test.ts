import { DependencyCoordinate } from '../../src/core/package-inventory';
import { detectServices, lookupService } from '../../src/core/service-catalog';

function coordinate(overrides: Partial<DependencyCoordinate>): DependencyCoordinate {
  return {
    ecosystem: 'npm', osvEcosystem: 'npm', name: 'stripe', exactVersion: '14.0.0', scope: 'runtime',
    direct: true, manifestPath: 'package.json', lockfilePath: 'package-lock.json', dependencyPaths: ['stripe@14.0.0'],
    ...overrides,
  };
}

describe('service catalog', () => {
  it('matches exact names before prefix rules', () => {
    expect(lookupService('npm', 'stripe')).toEqual(['Stripe', 'payments']);
    expect(lookupService('npm', '@aws-sdk/client-dynamodb')).toEqual(['DynamoDB', 'data-store']);
    expect(lookupService('npm', '@aws-sdk/client-s3')).toEqual(['AWS SDK v3', 'cloud']);
  });

  it('applies prefix rules only at a delimiter or module-path boundary', () => {
    expect(lookupService('pip', 'Google_Cloud.Storage')).toEqual(['Google Cloud', 'cloud']);
    expect(lookupService('go', 'github.com/stripe/stripe-go/v76')).toEqual(['Stripe', 'payments']);
    expect(lookupService('go', 'github.com/aws/aws-sdk-go-v2/service/dynamodb')).toEqual(['DynamoDB', 'data-store']);
    expect(lookupService('maven', 'software.amazon.awssdk:s3')).toEqual(['AWS SDK', 'cloud']);
  });

  it.each([
    ['npm', 'stripes'],
    ['npm', 'stripe-fake'],
    ['npm', '@aws-sdkx/client-s3'],
    ['npm', '@aws-sdk'],
    ['npm', 'openai-proxy'],
    ['go', 'github.com/stripe/stripe-gox'],
    ['pip', 'google-cloud'],
  ] as const)('does not detect the lookalike %s package %s', (ecosystem, name) => {
    expect(lookupService(ecosystem, name)).toBeUndefined();
  });

  it('reports direct inventory coordinates with package, version, manifest and scope', () => {
    const detections = detectServices([
      coordinate({}),
      coordinate({name: '@sentry/node', exactVersion: '8.1.0', scope: 'development', manifestPath: 'packages/api/package.json'}),
      coordinate({name: '@aws-sdk/client-s3', direct: false}),
      coordinate({name: 'left-pad'}),
    ]);

    expect(detections).toEqual([
      {
        service: 'Sentry', category: 'observability', ecosystem: 'npm', package: '@sentry/node',
        version: '8.1.0', manifestPath: 'packages/api/package.json', scope: 'development',
      },
      {
        service: 'Stripe', category: 'payments', ecosystem: 'npm', package: 'stripe',
        version: '14.0.0', manifestPath: 'package.json', scope: 'runtime',
      },
    ]);
  });

  it('credits every manifest that directly declares a package', () => {
    const detections = detectServices([coordinate({
      manifestPath: 'package.json', direct: true,
      directDeclarations: [
        {manifestPath: 'packages/app/package.json', scope: 'runtime'},
        {manifestPath: 'packages/web/package.json', scope: 'development'},
      ],
    })]);

    expect(detections.map(item => [item.manifestPath, item.scope])).toEqual([
      ['packages/app/package.json', 'runtime'],
      ['packages/web/package.json', 'development'],
    ]);
  });
});
