// script/update-db.ts
// 数据库更新和迁移脚本

import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import Rlog from "rlog-js";
import { pathToFileURL } from "url";

import { getPrismaDatabaseUrl, loadWebEnv } from "@/../scripts/load-env";
import { loadPrismaClientConstructor } from "@/../scripts/load-prisma-client";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let prisma: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pool: any;

// 加载 apps/web 与仓库根目录下的 .env* 文件
loadWebEnv();

const rlog = new Rlog();

type MigrateDeployRunner = () => Promise<void>;

// 获取项目中第一个迁移目录名
function getFirstProjectMigrationName(): string | null {
  try {
    const migrationDirCandidates = [
      path.resolve(process.cwd(), "prisma", "migrations"),
      path.resolve(process.cwd(), "apps", "web", "prisma", "migrations"),
    ];
    const migrationsDir = migrationDirCandidates.find((candidate) =>
      fs.existsSync(candidate),
    );

    if (!migrationsDir) {
      rlog.warning("  Migrations directory not found");
      return null;
    }

    const migrationDirs = fs
      .readdirSync(migrationsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));

    if (migrationDirs.length === 0) {
      rlog.warning("  No migration directories found in prisma/migrations");
      return null;
    }

    return migrationDirs[0] ?? null;
  } catch (error) {
    rlog.warning(`  Could not read project migrations: ${error}`);
    return null;
  }
}

// 主入口函数
async function main() {
  rlog.info("> Starting database update process...");

  try {
    await updateDatabase();
    rlog.success("  Database update completed successfully!");
  } catch (error) {
    rlog.error(
      `  Database update failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }
}

// 初始化 Prisma 客户端
async function initializePrismaClient() {
  try {
    const PrismaClient = await loadPrismaClientConstructor();
    const { Pool } = await import("pg");
    const { PrismaPg } = await import("@prisma/adapter-pg");

    // 使用与生产环境相同的 adapter 模式
    pool = new Pool({
      connectionString: getPrismaDatabaseUrl(),
    });
    const adapter = new PrismaPg(pool);

    prisma = new PrismaClient({
      adapter,
      log: [],
    });

    await prisma.$connect();
    rlog.success("✓ Prisma client initialized and connected");
  } catch (error) {
    throw new Error(`Failed to initialize Prisma client: ${error}`);
  }
}

// 检查数据库是否为空
async function isDatabaseEmpty(): Promise<boolean> {
  try {
    const tables = await prisma.$queryRaw`
      SELECT tablename 
      FROM pg_tables 
      WHERE schemaname = 'public'
    `;

    return !Array.isArray(tables) || tables.length === 0;
  } catch (error) {
    rlog.warning(`  Could not check if database is empty: ${error}`);
    return false;
  }
}

// 检查是否存在迁移表
async function hasMigrationsTable(): Promise<boolean> {
  try {
    const result = await prisma.$queryRaw`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public'
        AND table_name = '_prisma_migrations'
      )
    `;

    return (
      Array.isArray(result) &&
      result[0] &&
      (result[0] as { exists: boolean }).exists
    );
  } catch (error) {
    rlog.warning(`  Could not check migrations table: ${error}`);
    return false;
  }
}

// 检查迁移表中是否存在任何迁移记录
async function hasMigrationRecords(): Promise<boolean | null> {
  try {
    const result = await prisma.$queryRaw`
      SELECT EXISTS (
        SELECT 1
        FROM _prisma_migrations
      ) AS has_records
    `;

    return (
      Array.isArray(result) &&
      result[0] &&
      (result[0] as { has_records: boolean }).has_records
    );
  } catch (error) {
    rlog.warning(`  Could not check migration records: ${error}`);
    return null;
  }
}

// 检查数据库是否属于当前项目
async function isProjectDatabase(): Promise<boolean> {
  try {
    if (!(await hasMigrationsTable())) {
      return false;
    }

    const firstProjectMigration = getFirstProjectMigrationName();
    if (!firstProjectMigration) {
      return false;
    }

    const migrations = await prisma.$queryRaw`
      SELECT migration_name 
      FROM _prisma_migrations 
      ORDER BY finished_at
    `;

    if (!Array.isArray(migrations)) {
      return false;
    }

    const existingMigrations = migrations.map(
      (m: { migration_name: string }) => m.migration_name,
    );

    // 必须与项目第一个迁移名完全匹配，才认为是当前项目数据库
    const hasFirstProjectMigration = existingMigrations.some(
      (existing) => existing === firstProjectMigration,
    );

    if (!hasFirstProjectMigration) {
      rlog.warning(
        "  Database contains migrations but does not match this project's first migration",
      );
      rlog.warning("  Existing migrations:");
      existingMigrations.forEach((name) => {
        rlog.warning(`  | ${name}`);
      });
      rlog.warning("  Expected first project migration:");
      rlog.warning(`  | ${firstProjectMigration}`);
      return false;
    }

    rlog.success(
      `✓ Database contains ${existingMigrations.length} migrations from this project`,
    );
    return true;
  } catch (error) {
    rlog.warning(`  Could not verify project database: ${error}`);
    return false;
  }
}

// 运行 Prisma migrate deploy
async function runMigrateDeploy(): Promise<void> {
  try {
    rlog.info("> Running prisma migrate deploy...");

    const { runPrismaMigrateDeploy } = await import(
      "@/lib/server/prisma-migrate"
    );

    let output = "";
    await runPrismaMigrateDeploy({
      cwd: process.cwd(),
      logger: (line: string) => {
        output += line + "\n";
        rlog.info(line);
      },
    });

    // 如果输出包含有用信息，显示它
    if (output && output.trim()) {
      const lines = output.trim().split("\n");
      lines.forEach((line) => {
        if (
          line.includes("Applied") ||
          line.includes("migration") ||
          line.includes("Database")
        ) {
          rlog.info(`  | ${line.trim()}`);
        }
      });
    }

    rlog.success("✓ Prisma migrate deploy completed successfully");
  } catch (error) {
    if (error instanceof Error && "stdout" in error) {
      const execError = error as Error & {
        stdout?: Buffer | string;
        stderr?: Buffer | string;
      };
      const stdout = execError.stdout?.toString();
      const stderr = execError.stderr?.toString();

      if (stdout) {
        rlog.info("  Migrate output:");
        stdout.split("\n").forEach((line: string) => {
          if (line.trim()) rlog.info(`  | ${line.trim()}`);
        });
      }

      if (stderr) {
        rlog.error("  Migrate errors:");
        stderr.split("\n").forEach((line: string) => {
          if (line.trim()) rlog.error(`  | ${line.trim()}`);
        });
      }
    }
    throw new Error(`Prisma migrate deploy failed: ${error}`);
  }
}

// 导出的更新函数（避免重复执行main函数）
export async function updateDatabase(options?: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prisma?: any;
  runMigrateDeploy?: MigrateDeployRunner;
}): Promise<void> {
  const externalPrisma = options?.prisma;
  const shouldManagePrismaLifecycle = !externalPrisma;
  try {
    rlog.info("> Starting database update...");
    if (externalPrisma) {
      prisma = externalPrisma;
    } else {
      await initializePrismaClient();
    }
    await updateDatabaseInternal(options?.runMigrateDeploy);
  } finally {
    if (shouldManagePrismaLifecycle) {
      await cleanup();
    }
  }
}

// 内部更新逻辑（重命名避免冲突）
async function updateDatabaseInternal(
  migrateDeployRunner?: MigrateDeployRunner,
): Promise<void> {
  const runMigrate = migrateDeployRunner ?? runMigrateDeploy;
  const isEmpty = await isDatabaseEmpty();

  if (isEmpty) {
    rlog.info("  Database is empty, initializing with migrations...");
    await runMigrate();
    rlog.success("✓ Database initialized successfully");
    return;
  }

  const hasMigrations = await hasMigrationsTable();
  if (hasMigrations) {
    const hasRecords = await hasMigrationRecords();
    if (hasRecords === false) {
      rlog.info(
        "  Migrations table exists but contains no records, initializing with migrations...",
      );
      await runMigrate();
      rlog.success("✓ Database initialized successfully");
      return;
    }
    if (hasRecords === null) {
      rlog.warning(
        "  Could not determine whether migrations table has records, continuing with project database check...",
      );
    }
  }

  rlog.info(
    "> Database is not empty, checking if it belongs to this project...",
  );

  const isProjectDb = await isProjectDatabase();

  if (!isProjectDb) {
    throw new Error(
      "Database contains data but does not appear to belong to this project. " +
        "Please use a different database or manually verify the database contents.",
    );
  }

  rlog.info(
    "  Database belongs to this project, applying any pending migrations...",
  );
  await runMigrate();
  rlog.success("  Database updated successfully");
}

// 清理资源
async function cleanup() {
  if (prisma) {
    try {
      await prisma.$disconnect();
      rlog.info("  Database connection closed");
    } catch (error) {
      rlog.warning(
        `  Error closing database connection: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  if (pool) {
    try {
      await pool.end();
      rlog.info("  Connection pool closed");
    } catch (error) {
      rlog.warning(
        `  Error closing connection pool: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

// 检查是否是直接运行
function isMainModule(): boolean {
  try {
    // 检查当前文件是否是主模块
    const arg1 = process.argv[1];
    return (
      import.meta.url === pathToFileURL(arg1 || "").href ||
      (arg1?.endsWith("update-db.ts") ?? false) ||
      (arg1?.endsWith("update-db.js") ?? false)
    );
  } catch {
    return false;
  }
}

// 如果直接运行此脚本
if (isMainModule()) {
  main();
}
