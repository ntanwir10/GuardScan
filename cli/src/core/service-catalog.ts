import type {DependencyCoordinate, DependencyScope, PackageEcosystem} from './package-inventory';

export type ServiceCategory = 'payments' | 'cloud' | 'ai' | 'auth' | 'messaging' | 'observability' | 'data-store';

export interface ServiceDetection {
  service: string;
  category: ServiceCategory;
  ecosystem: PackageEcosystem;
  package: string;
  version: string;
  manifestPath: string;
  scope: DependencyScope;
}

type Entry = readonly [service: string, category: ServiceCategory];

interface EcosystemCatalog {
  /** Exact package names. These win over every prefix rule. */
  exact: Readonly<Record<string, Entry>>;
  /**
   * A prefix ending in `/`, `-`, `_`, `:` or `.` matches any name that starts with it.
   * Any other prefix is a module root: it matches itself or `<prefix>/...` (Go modules).
   */
  prefixes: Readonly<Record<string, Entry>>;
}

const STRIPE: Entry = ['Stripe', 'payments'];
const PAYPAL: Entry = ['PayPal', 'payments'];
const BRAINTREE: Entry = ['Braintree', 'payments'];
const ADYEN: Entry = ['Adyen', 'payments'];
const SQUARE: Entry = ['Square', 'payments'];
const RAZORPAY: Entry = ['Razorpay', 'payments'];
const MOLLIE: Entry = ['Mollie', 'payments'];
const CHECKOUT: Entry = ['Checkout.com', 'payments'];
const KLARNA: Entry = ['Klarna', 'payments'];
const AWS: Entry = ['AWS SDK', 'cloud'];
const AWS_V2: Entry = ['AWS SDK v2', 'cloud'];
const AWS_V3: Entry = ['AWS SDK v3', 'cloud'];
const GOOGLE_CLOUD: Entry = ['Google Cloud', 'cloud'];
const GOOGLE_APIS: Entry = ['Google APIs', 'cloud'];
const AZURE: Entry = ['Azure', 'cloud'];
const FIREBASE: Entry = ['Firebase', 'cloud'];
const OPENAI: Entry = ['OpenAI', 'ai'];
const ANTHROPIC: Entry = ['Anthropic', 'ai'];
const GEMINI: Entry = ['Google Gemini', 'ai'];
const COHERE: Entry = ['Cohere', 'ai'];
const MISTRAL: Entry = ['Mistral', 'ai'];
const AUTH0: Entry = ['Auth0', 'auth'];
const OKTA: Entry = ['Okta', 'auth'];
const CLERK: Entry = ['Clerk', 'auth'];
const SUPABASE: Entry = ['Supabase', 'auth'];
const NEXTAUTH: Entry = ['NextAuth', 'auth'];
const TWILIO: Entry = ['Twilio', 'messaging'];
const SENDGRID: Entry = ['SendGrid', 'messaging'];
const POSTMARK: Entry = ['Postmark', 'messaging'];
const MAILGUN: Entry = ['Mailgun', 'messaging'];
const RESEND: Entry = ['Resend', 'messaging'];
const SLACK: Entry = ['Slack', 'messaging'];
const SENTRY: Entry = ['Sentry', 'observability'];
const DATADOG: Entry = ['Datadog', 'observability'];
const NEW_RELIC: Entry = ['New Relic', 'observability'];
const OPENTELEMETRY: Entry = ['OpenTelemetry', 'observability'];
const POSTGRES: Entry = ['PostgreSQL', 'data-store'];
const MYSQL: Entry = ['MySQL', 'data-store'];
const MONGODB: Entry = ['MongoDB', 'data-store'];
const REDIS: Entry = ['Redis', 'data-store'];
const PRISMA: Entry = ['Prisma', 'data-store'];
const DYNAMODB: Entry = ['DynamoDB', 'data-store'];

export const SERVICE_CATALOG: Readonly<Record<PackageEcosystem, EcosystemCatalog>> = {
  npm: {
    exact: {
      'stripe': STRIPE, '@stripe/stripe-js': STRIPE, '@stripe/react-stripe-js': STRIPE,
      '@paypal/checkout-server-sdk': PAYPAL, '@paypal/paypal-server-sdk': PAYPAL, '@paypal/paypal-js': PAYPAL,
      '@paypal/react-paypal-js': PAYPAL, 'paypal-rest-sdk': PAYPAL,
      'braintree': BRAINTREE, 'braintree-web': BRAINTREE, 'braintree-web-drop-in': BRAINTREE,
      '@adyen/api-library': ADYEN, '@adyen/adyen-web': ADYEN,
      'square': SQUARE, 'razorpay': RAZORPAY, '@mollie/api-client': MOLLIE, 'checkout-sdk-node': CHECKOUT,
      'aws-sdk': AWS_V2,
      '@aws-sdk/client-dynamodb': DYNAMODB, '@aws-sdk/lib-dynamodb': DYNAMODB, '@aws-sdk/util-dynamodb': DYNAMODB,
      'googleapis': GOOGLE_APIS,
      'firebase': FIREBASE, 'firebase-admin': FIREBASE, 'firebase-functions': FIREBASE,
      'openai': OPENAI, '@google/generative-ai': GEMINI, '@google/genai': GEMINI, 'cohere-ai': COHERE,
      'auth0': AUTH0, 'next-auth': NEXTAUTH,
      'twilio': TWILIO, 'postmark': POSTMARK, 'mailgun.js': MAILGUN, 'mailgun-js': MAILGUN, 'resend': RESEND,
      'dd-trace': DATADOG, 'newrelic': NEW_RELIC,
      'pg': POSTGRES, 'postgres': POSTGRES, 'pg-promise': POSTGRES,
      'mysql': MYSQL, 'mysql2': MYSQL, 'mongodb': MONGODB, 'mongoose': MONGODB,
      'redis': REDIS, 'ioredis': REDIS, 'prisma': PRISMA, '@prisma/client': PRISMA,
    },
    prefixes: {
      // Vendor-owned npm scopes: every package in them belongs to the vendor.
      '@klarna/': KLARNA, '@aws-sdk/': AWS_V3, '@google-cloud/': GOOGLE_CLOUD, '@azure/': AZURE,
      '@firebase/': FIREBASE, '@anthropic-ai/': ANTHROPIC, '@mistralai/': MISTRAL, '@auth0/': AUTH0,
      '@okta/': OKTA, '@clerk/': CLERK, '@supabase/': SUPABASE, '@auth/': NEXTAUTH, '@sendgrid/': SENDGRID,
      '@slack/': SLACK, '@sentry/': SENTRY, '@datadog/': DATADOG, '@newrelic/': NEW_RELIC,
      '@opentelemetry/': OPENTELEMETRY, '@redis/': REDIS,
    },
  },
  pip: {
    exact: {
      'stripe': STRIPE, 'paypalrestsdk': PAYPAL, 'paypal-checkout-serversdk': PAYPAL, 'paypal-server-sdk': PAYPAL,
      'braintree': BRAINTREE, 'adyen': ADYEN, 'squareup': SQUARE, 'razorpay': RAZORPAY,
      'mollie-api-python': MOLLIE, 'checkout-sdk': CHECKOUT,
      'boto3': AWS, 'botocore': AWS, 'aiobotocore': AWS, 'aioboto3': AWS,
      'google-api-python-client': GOOGLE_APIS, 'firebase-admin': FIREBASE,
      'openai': OPENAI, 'anthropic': ANTHROPIC, 'google-generativeai': GEMINI, 'google-genai': GEMINI,
      'cohere': COHERE, 'mistralai': MISTRAL,
      'auth0-python': AUTH0, 'okta': OKTA, 'clerk-backend-api': CLERK, 'supabase': SUPABASE,
      'twilio': TWILIO, 'sendgrid': SENDGRID, 'postmarker': POSTMARK, 'resend': RESEND,
      'slack-sdk': SLACK, 'slack-bolt': SLACK, 'slackclient': SLACK,
      'sentry-sdk': SENTRY, 'ddtrace': DATADOG, 'datadog': DATADOG, 'newrelic': NEW_RELIC,
      'psycopg2': POSTGRES, 'psycopg2-binary': POSTGRES, 'psycopg': POSTGRES, 'asyncpg': POSTGRES, 'pg8000': POSTGRES,
      'mysqlclient': MYSQL, 'pymysql': MYSQL, 'mysql-connector-python': MYSQL, 'aiomysql': MYSQL,
      'pymongo': MONGODB, 'motor': MONGODB, 'redis': REDIS, 'prisma': PRISMA,
    },
    prefixes: {
      'google-cloud-': GOOGLE_CLOUD, 'azure-': AZURE, 'opentelemetry-': OPENTELEMETRY,
    },
  },
  go: {
    exact: {},
    prefixes: {
      'github.com/stripe/stripe-go': STRIPE, 'github.com/adyen/adyen-go-api-library': ADYEN,
      'github.com/square/square-go-sdk': SQUARE, 'github.com/razorpay/razorpay-go': RAZORPAY,
      'github.com/checkout/checkout-sdk-go': CHECKOUT,
      'github.com/aws/aws-sdk-go': AWS, 'github.com/aws/aws-sdk-go-v2': AWS,
      'github.com/aws/aws-sdk-go-v2/service/dynamodb': DYNAMODB, 'github.com/aws/aws-sdk-go-v2/feature/dynamodb': DYNAMODB,
      'cloud.google.com/go': GOOGLE_CLOUD, 'google.golang.org/api': GOOGLE_APIS, 'firebase.google.com/go': FIREBASE,
      'github.com/Azure/azure-sdk-for-go': AZURE,
      'github.com/openai/openai-go': OPENAI, 'github.com/sashabaranov/go-openai': OPENAI,
      'github.com/anthropics/anthropic-sdk-go': ANTHROPIC,
      'github.com/google/generative-ai-go': GEMINI, 'google.golang.org/genai': GEMINI,
      'github.com/cohere-ai/cohere-go': COHERE,
      'github.com/auth0/go-auth0': AUTH0, 'github.com/auth0/go-jwt-middleware': AUTH0,
      'github.com/okta/okta-sdk-golang': OKTA, 'github.com/okta/okta-jwt-verifier-golang': OKTA,
      'github.com/clerk/clerk-sdk-go': CLERK, 'github.com/supabase-community/supabase-go': SUPABASE,
      'github.com/twilio/twilio-go': TWILIO, 'github.com/sendgrid/sendgrid-go': SENDGRID,
      'github.com/mailgun/mailgun-go': MAILGUN, 'github.com/resend/resend-go': RESEND, 'github.com/slack-go/slack': SLACK,
      'github.com/getsentry/sentry-go': SENTRY, 'github.com/DataDog/dd-trace-go': DATADOG,
      'gopkg.in/DataDog/dd-trace-go.v1': DATADOG, 'github.com/newrelic/go-agent': NEW_RELIC,
      'go.opentelemetry.io/': OPENTELEMETRY,
      'github.com/jackc/pgx': POSTGRES, 'github.com/lib/pq': POSTGRES, 'github.com/go-sql-driver/mysql': MYSQL,
      'go.mongodb.org/mongo-driver': MONGODB, 'github.com/redis/go-redis': REDIS, 'github.com/go-redis/redis': REDIS,
      'github.com/gomodule/redigo': REDIS, 'github.com/steebchen/prisma-client-go': PRISMA,
    },
  },
  ruby: {
    exact: {
      'stripe': STRIPE, 'braintree': BRAINTREE, 'adyen-ruby-api-library': ADYEN, 'square.rb': SQUARE,
      'razorpay': RAZORPAY, 'mollie-api-ruby': MOLLIE,
      'aws-sdk': AWS, 'aws-sdk-dynamodb': DYNAMODB,
      'ruby-openai': OPENAI, 'anthropic': ANTHROPIC, 'auth0': AUTH0, 'omniauth-auth0': AUTH0,
      'twilio-ruby': TWILIO, 'sendgrid-ruby': SENDGRID, 'postmark': POSTMARK, 'postmark-rails': POSTMARK,
      'mailgun-ruby': MAILGUN, 'resend': RESEND, 'slack-ruby-client': SLACK,
      'sentry-ruby': SENTRY, 'sentry-rails': SENTRY, 'ddtrace': DATADOG, 'datadog': DATADOG, 'newrelic_rpm': NEW_RELIC,
      'pg': POSTGRES, 'mysql2': MYSQL, 'mongo': MONGODB, 'mongoid': MONGODB, 'redis': REDIS,
    },
    prefixes: {
      'aws-sdk-': AWS, 'google-cloud-': GOOGLE_CLOUD, 'azure-': AZURE, 'opentelemetry-': OPENTELEMETRY,
    },
  },
  cargo: {
    exact: {
      'async-stripe': STRIPE, 'aws-config': AWS, 'aws-sdk-dynamodb': DYNAMODB, 'async-openai': OPENAI,
      'sentry': SENTRY, 'opentelemetry': OPENTELEMETRY,
      'postgres': POSTGRES, 'tokio-postgres': POSTGRES, 'mysql': MYSQL, 'mysql_async': MYSQL,
      'mongodb': MONGODB, 'redis': REDIS,
    },
    prefixes: {
      'aws-sdk-': AWS, 'google-cloud-': GOOGLE_CLOUD, 'azure_': AZURE,
      'opentelemetry-': OPENTELEMETRY, 'opentelemetry_': OPENTELEMETRY,
    },
  },
  maven: {
    exact: {
      'com.stripe:stripe-java': STRIPE, 'com.braintreepayments.gateway:braintree-java': BRAINTREE,
      'com.adyen:adyen-java-api-library': ADYEN, 'com.squareup:square': SQUARE,
      'com.razorpay:razorpay-java': RAZORPAY, 'com.checkout:checkout-sdk-java': CHECKOUT,
      'software.amazon.awssdk:dynamodb': DYNAMODB, 'software.amazon.awssdk:dynamodb-enhanced': DYNAMODB,
      'com.amazonaws:aws-java-sdk-dynamodb': DYNAMODB, 'com.google.firebase:firebase-admin': FIREBASE,
      'com.openai:openai-java': OPENAI, 'com.anthropic:anthropic-java': ANTHROPIC, 'com.google.genai:google-genai': GEMINI,
      'com.twilio.sdk:twilio': TWILIO, 'com.sendgrid:sendgrid-java': SENDGRID, 'com.postmarkapp:postmark': POSTMARK,
      'org.postgresql:postgresql': POSTGRES, 'com.mysql:mysql-connector-j': MYSQL, 'mysql:mysql-connector-java': MYSQL,
      'redis.clients:jedis': REDIS, 'io.lettuce:lettuce-core': REDIS,
    },
    prefixes: {
      'com.paypal.sdk:': PAYPAL, 'software.amazon.awssdk:': AWS, 'com.amazonaws:': AWS,
      'com.google.cloud:': GOOGLE_CLOUD, 'com.azure:': AZURE, 'com.microsoft.azure:': AZURE,
      'com.auth0:': AUTH0, 'com.okta.': OKTA, 'com.slack.api:': SLACK,
      'io.sentry:': SENTRY, 'com.datadoghq:': DATADOG, 'com.newrelic.agent.java:': NEW_RELIC,
      'io.opentelemetry:': OPENTELEMETRY, 'io.opentelemetry.': OPENTELEMETRY, 'org.mongodb:': MONGODB,
    },
  },
};

const DELIMITED_PREFIX = /[/:._-]$/;

export function lookupService(ecosystem: PackageEcosystem, name: string): Entry | undefined {
  const catalog = SERVICE_CATALOG[ecosystem];
  const key = ecosystem === 'pip' ? name.toLowerCase().replace(/[-_.]+/g, '-') : name;
  if (Object.prototype.hasOwnProperty.call(catalog.exact, key)) {return catalog.exact[key];}
  let best: string | undefined;
  for (const prefix of Object.keys(catalog.prefixes)) {
    const matches = DELIMITED_PREFIX.test(prefix)
      ? key.startsWith(prefix) && key.length > prefix.length
      : key === prefix || key.startsWith(`${prefix}/`);
    if (matches && (!best || prefix.length > best.length)) {best = prefix;}
  }
  return best === undefined ? undefined : catalog.prefixes[best];
}

/** Services come from direct inventory coordinates only, never from source text. */
export function detectServices(coordinates: readonly DependencyCoordinate[]): ServiceDetection[] {
  const detections = new Map<string, ServiceDetection>();
  for (const coordinate of coordinates) {
    if (!coordinate.direct) {continue;}
    const entry = lookupService(coordinate.ecosystem, coordinate.name);
    if (!entry) {continue;}
    for (const declaration of coordinate.directDeclarations || [{manifestPath: coordinate.manifestPath, scope: coordinate.scope}]) {
      const detection: ServiceDetection = {
        service: entry[0],
        category: entry[1],
        ecosystem: coordinate.ecosystem,
        package: coordinate.name,
        version: coordinate.exactVersion,
        manifestPath: declaration.manifestPath,
        scope: declaration.scope,
      };
      detections.set(
        [detection.service, detection.ecosystem, detection.package, detection.version, detection.manifestPath].join('\0'),
        detection
      );
    }
  }
  return [...detections.values()].sort((left, right) =>
    left.category.localeCompare(right.category) ||
    left.service.localeCompare(right.service) ||
    left.package.localeCompare(right.package) ||
    left.manifestPath.localeCompare(right.manifestPath) ||
    left.version.localeCompare(right.version)
  );
}
