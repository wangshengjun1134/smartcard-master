declare module '@opentelemetry/sdk-metrics' {
  export interface ResourceMetrics {
    resource: unknown;
    scopeMetrics: unknown[];
  }

  export interface PushMetricExporter {
    export(
      metrics: ResourceMetrics,
      resultCallback: (result: { code: number; error?: Error }) => void,
    ): void;
    forceFlush(): Promise<void>;
    shutdown(): Promise<void>;
  }

  export enum AggregationTemporality {
    UNSPECIFIED = 0,
    DELTA = 1,
    CUMULATIVE = 2,
  }

  export interface PeriodicExportingMetricReaderOptions {
    exporter: PushMetricExporter;
    exportIntervalMillis?: number;
    exportTimeoutMillis?: number;
  }

  export class PeriodicExportingMetricReader {
    constructor(options: PeriodicExportingMetricReaderOptions);
    forceFlush(): Promise<void>;
    shutdown(): Promise<void>;
  }

  export class MeterProvider {
    constructor(options?: unknown);
    getMeter(name: string, version?: string, schemaUrl?: string): unknown;
    addMetricReader(reader: PeriodicExportingMetricReader): void;
    forceFlush(): Promise<void>;
    shutdown(): Promise<void>;
  }
}
