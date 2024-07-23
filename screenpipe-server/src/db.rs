use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::migrate::MigrateDatabase;
use sqlx::{
    sqlite::{SqlitePool, SqlitePoolOptions},
    FromRow,
};
use std::time::Duration;
use log::{debug, error, info}; // Ensure you have the log crate imported

#[derive(Debug, Serialize)]
pub enum SearchResult {
    OCR(OCRResult),
    Audio(AudioResult),
}

#[derive(Debug, Serialize, FromRow)]
pub struct OCRResult {
    pub frame_id: i64,
    pub ocr_text: String,
    pub text_json: String, // Store as JSON string
    pub new_text_json: String, // Store as JSON string
    pub data_output: String, // Store as JSON string
    pub timestamp: DateTime<Utc>,
    pub file_path: String,
    pub offset_index: i64,
}

#[derive(Debug, Deserialize, PartialEq, Default, Clone, Copy)]
#[serde(rename_all = "lowercase")]
pub enum ContentType {
    #[default]
    All,
    OCR,
    Audio,
}

#[derive(Debug, Serialize, FromRow)]
pub struct AudioResult {
    pub audio_chunk_id: i64,
    pub transcription: String,
    pub timestamp: DateTime<Utc>,
    pub file_path: String,
    pub offset_index: i64,
}

pub struct DatabaseManager {
    pool: SqlitePool,
}

impl DatabaseManager {
    pub async fn new(database_path: &str) -> Result<Self, sqlx::Error> {

        // if std::env::var("RUST_LOG").is_err() {
        //     env_logger::Builder::from_env(Env::default().default_filter_or("info")).init();
        // }
        debug!("db.rs initialized successfully.");
        let connection_string = format!("sqlite:{}", database_path);

        // Create the database if it doesn't exist
        if !sqlx::Sqlite::database_exists(&connection_string).await? {
            sqlx::Sqlite::create_database(&connection_string).await?;
        }

        let pool = SqlitePoolOptions::new()
            .max_connections(5)
            .acquire_timeout(Duration::from_secs(3))
            .connect(&connection_string)
            .await?;

        let db_manager = DatabaseManager { pool };

        // Run migrations after establishing the connection
        if let Err(e) = Self::run_migrations(&db_manager.pool).await {
            error!("Failed to run migrations: {}", e);
            return Err(e);
        }

        info!("Migrations executed successfully.");
        Ok(db_manager)
    }

    async fn run_migrations(pool: &SqlitePool) -> Result<(), sqlx::Error> {
        sqlx::migrate!("./src/migrations").run(pool).await?;
        Ok(())
    }

    pub async fn insert_audio_chunk(&self, file_path: &str) -> Result<i64, sqlx::Error> {
        let mut tx = self.pool.begin().await?;
        let id = sqlx::query("INSERT INTO audio_chunks (file_path) VALUES (?1)")
            .bind(file_path)
            .execute(&mut *tx)
            .await?
            .last_insert_rowid();
        tx.commit().await?;
        Ok(id)
    }

    pub async fn insert_audio_transcription(
        &self,
        audio_chunk_id: i64,
        transcription: &str,
        offset_index: i64,
    ) -> Result<(), sqlx::Error> {
        let mut tx = self.pool.begin().await?;
        sqlx::query(
            "INSERT INTO audio_transcriptions (audio_chunk_id, transcription, offset_index, timestamp) VALUES (?1, ?2, ?3, ?4)",
        )
        .bind(audio_chunk_id)
        .bind(transcription)
        .bind(offset_index)
        .bind(Utc::now())
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(())
    }

    pub async fn insert_video_chunk(&self, file_path: &str) -> Result<i64, sqlx::Error> {
        let mut tx = self.pool.begin().await?;
        let id = sqlx::query("INSERT INTO video_chunks (file_path) VALUES (?1)")
            .bind(file_path)
            .execute(&mut *tx)
            .await?
            .last_insert_rowid();
        tx.commit().await?;
        Ok(id)
    }

    pub async fn insert_frame(&self) -> Result<i64, sqlx::Error> {
        let mut tx = self.pool.begin().await?;

        // Get the most recent video_chunk_id
        let video_chunk_id: Option<i64> =
            sqlx::query_scalar("SELECT id FROM video_chunks ORDER BY id DESC LIMIT 1")
                .fetch_optional(&mut *tx)
                .await?;

        // If no video chunk is found, return 0
        let video_chunk_id = match video_chunk_id {
            Some(id) => id,
            None => {
                tx.rollback().await?;
                return Ok(0);
            }
        };

        // ... rest of the function remains the same
        let offset_index: i64 = sqlx::query_scalar(
            "SELECT COALESCE(MAX(offset_index), -1) + 1 FROM frames WHERE video_chunk_id = ?1",
        )
        .bind(video_chunk_id)
        .fetch_one(&mut *tx)
        .await?;

        let id = sqlx::query(
            "INSERT INTO frames (video_chunk_id, offset_index, timestamp) VALUES (?1, ?2, ?3)",
        )
        .bind(video_chunk_id)
        .bind(offset_index)
        .bind(Utc::now())
        .execute(&mut *tx)
        .await?
        .last_insert_rowid();

        tx.commit().await?;
        Ok(id)
    }

    pub async fn insert_ocr_text(
        &self,
        frame_id: i64,
        text: &str,
        text_json: &str,
        new_text_json_vs_previous_frame: &str,
        raw_data_output_from_OCR: &str,
    ) -> Result<(), sqlx::Error> {
        // Function to limit string length
        fn limit_string(s: &str) -> String {
            if s.len() > 5 {
                format!("{}...", &s[..5])
            } else {
                s.to_string()
            }
        }
    
        // Log the input parameters with limited length
        debug!(target: "db::ocr", "Inserting OCR text with frame_id: {}, text: {}, text_json: {}, new_text_json_vs_previous_frame: {}, raw_data_output_from_OCR: {}", 
            frame_id, 
            limit_string(text), 
            limit_string(text_json), 
            limit_string(new_text_json_vs_previous_frame), 
            limit_string(raw_data_output_from_OCR)
        );
    
        let mut tx = self.pool.begin().await?;
        sqlx::query("INSERT INTO ocr_text (frame_id, text, text_json, new_text_json_vs_previous_frame, raw_data_output_from_OCR) VALUES (?1, ?2, ?3, ?4, ?5)")
            .bind(frame_id)
            .bind(text)
            .bind(text_json)
            .bind(new_text_json_vs_previous_frame)
            .bind(raw_data_output_from_OCR)
            .execute(&mut *tx)
            .await?;
    
        // Log successful insertion
        debug!(target: "db::ocr", "Successfully inserted OCR text for frame_id: {}", frame_id);
    
        tx.commit().await?;
        Ok(())
    }

    pub async fn search(
        &self,
        query: &str,
        content_type: ContentType,
        limit: u32,
        offset: u32,
        start_time: Option<DateTime<Utc>>,
        end_time: Option<DateTime<Utc>>,
    ) -> Result<Vec<SearchResult>, sqlx::Error> {
        let mut results = Vec::new();

        if content_type == ContentType::All || content_type == ContentType::OCR {
            let ocr_results = self.search_ocr(query, limit, offset, start_time, end_time).await?;
            results.extend(ocr_results.into_iter().map(SearchResult::OCR));
        }

        if content_type == ContentType::All || content_type == ContentType::Audio {
            let audio_results = self.search_audio(query, limit, offset, start_time, end_time).await?;
            results.extend(audio_results.into_iter().map(SearchResult::Audio));
        }

        // Sort results by timestamp in descending order
        results.sort_by(|a, b| {
            let timestamp_a = match a {
                SearchResult::OCR(ocr) => ocr.timestamp,
                SearchResult::Audio(audio) => audio.timestamp,
            };
            let timestamp_b = match b {
                SearchResult::OCR(ocr) => ocr.timestamp,
                SearchResult::Audio(audio) => audio.timestamp,
            };
            timestamp_b.cmp(&timestamp_a)
        });

        // Apply limit after combining and sorting
        results.truncate(limit as usize);

        Ok(results)
    }

    async fn search_ocr(
        &self,
        query: &str,
        limit: u32,
        offset: u32,
        start_time: Option<DateTime<Utc>>,
        end_time: Option<DateTime<Utc>>,
    ) -> Result<Vec<OCRResult>, sqlx::Error> {
        sqlx::query_as::<_, OCRResult>(
            r#"
            SELECT 
                ocr_text.frame_id,
                ocr_text.text as ocr_text,
                ocr_text.text_json,
                ocr_text.new_text_json,
                ocr_text.data_output,
                frames.timestamp,
                video_chunks.file_path,
                frames.offset_index
            FROM 
                ocr_text
            JOIN 
                frames ON ocr_text.frame_id = frames.id
            JOIN 
                video_chunks ON frames.video_chunk_id = video_chunks.id
            WHERE 
                ocr_text.text LIKE '%' || ?1 || '%'
                AND (?2 IS NULL OR frames.timestamp >= ?2)
                AND (?3 IS NULL OR frames.timestamp <= ?3)
            ORDER BY 
                frames.timestamp DESC
            LIMIT ?4 OFFSET ?5
            "#,
        )
        .bind(query)
        .bind(start_time)
        .bind(end_time)
        .bind(limit)
        .bind(offset)
        .fetch_all(&self.pool)
        .await
    }

    async fn search_audio(
        &self,
        query: &str,
        limit: u32,
        offset: u32,
        start_time: Option<DateTime<Utc>>,
        end_time: Option<DateTime<Utc>>,
    ) -> Result<Vec<AudioResult>, sqlx::Error> {
        sqlx::query_as::<_, AudioResult>(
            r#"
            SELECT 
                audio_transcriptions.audio_chunk_id,
                audio_transcriptions.transcription,
                audio_transcriptions.timestamp,
                audio_chunks.file_path,
                audio_transcriptions.offset_index
            FROM 
                audio_transcriptions
            JOIN 
                audio_chunks ON audio_transcriptions.audio_chunk_id = audio_chunks.id
            WHERE 
                audio_transcriptions.transcription LIKE '%' || ?1 || '%'
                AND (?2 IS NULL OR audio_transcriptions.timestamp >= ?2)
                AND (?3 IS NULL OR audio_transcriptions.timestamp <= ?3)
            ORDER BY 
                audio_transcriptions.timestamp DESC
            LIMIT ?4 OFFSET ?5
            "#,
        )
        .bind(query)
        .bind(start_time)
        .bind(end_time)
        .bind(limit)
        .bind(offset)
        .fetch_all(&self.pool)
        .await
    }

    pub async fn get_frame(&self, frame_id: i64) -> Result<Option<(String, i64)>, sqlx::Error> {
        sqlx::query_as::<_, (String, i64)>(
            r#"
            SELECT 
                video_chunks.file_path,
                frames.offset_index
            FROM 
                frames
            JOIN 
                video_chunks ON frames.video_chunk_id = video_chunks.id
            WHERE 
                frames.id = ?1
            "#,
        )
        .bind(frame_id)
        .fetch_optional(&self.pool)
        .await
    }

    pub async fn get_recent_results(
        &self,
        limit: u32,
        offset: u32,
        start_timestamp: Option<DateTime<Utc>>,
        end_timestamp: Option<DateTime<Utc>>,
    ) -> Result<Vec<SearchResult>, sqlx::Error> {
        let mut results = Vec::new();

        let ocr_query = r#"
            SELECT 
                ocr_text.frame_id,
                ocr_text.text as ocr_text,
                ocr_text.text_json,
                ocr_text.new_text_json,
                ocr_text.data_output,
                frames.timestamp,
                video_chunks.file_path,
                frames.offset_index
            FROM 
                ocr_text
            JOIN 
                frames ON ocr_text.frame_id = frames.id
            JOIN 
                video_chunks ON frames.video_chunk_id = video_chunks.id
            WHERE 
                1=1
                AND (?1 IS NULL OR frames.timestamp >= ?1)
                AND (?2 IS NULL OR frames.timestamp <= ?2)
            ORDER BY 
                frames.timestamp DESC
            LIMIT ?3 OFFSET ?4
        "#;

        let ocr_results = sqlx::query_as::<_, OCRResult>(ocr_query)
            .bind(start_timestamp)
            .bind(end_timestamp)
            .bind(limit)
            .bind(offset)
            .fetch_all(&self.pool)
            .await?;

        results.extend(ocr_results.into_iter().map(SearchResult::OCR));

        let audio_query = r#"
            SELECT 
                audio_transcriptions.audio_chunk_id,
                audio_transcriptions.transcription,
                audio_transcriptions.timestamp,
                audio_chunks.file_path,
                audio_transcriptions.offset_index
            FROM 
                audio_transcriptions
            JOIN 
                audio_chunks ON audio_transcriptions.audio_chunk_id = audio_chunks.id
            WHERE 
                1=1
                AND (?1 IS NULL OR audio_transcriptions.timestamp >= ?1)
                AND (?2 IS NULL OR audio_transcriptions.timestamp <= ?2)
            ORDER BY 
                audio_transcriptions.timestamp DESC
            LIMIT ?3 OFFSET ?4
        "#;

        let audio_results = sqlx::query_as::<_, AudioResult>(audio_query)
            .bind(start_timestamp)
            .bind(end_timestamp)
            .bind(limit)
            .bind(offset)
            .fetch_all(&self.pool)
            .await?;

        results.extend(audio_results.into_iter().map(SearchResult::Audio));

        // Sort combined results by timestamp
        results.sort_by(|a, b| {
            let timestamp_a = match a {
                SearchResult::OCR(ocr) => ocr.timestamp,
                SearchResult::Audio(audio) => audio.timestamp,
            };
            let timestamp_b = match b {
                SearchResult::OCR(ocr) => ocr.timestamp,
                SearchResult::Audio(audio) => audio.timestamp,
            };
            timestamp_b.cmp(&timestamp_a)
        });

        // Limit the final combined results
        results.truncate(limit as usize);

        Ok(results)
    }
    pub async fn count_search_results(
        &self,
        query: &str,
        content_type: ContentType,
        start_time: Option<DateTime<Utc>>,
        end_time: Option<DateTime<Utc>>,
    ) -> Result<usize, sqlx::Error> {
        let mut total_count = 0;

        if content_type == ContentType::All || content_type == ContentType::OCR {
            let ocr_count: (i64,) = sqlx::query_as(
                r#"
                SELECT COUNT(*)
                FROM ocr_text
                JOIN frames ON ocr_text.frame_id = frames.id
                WHERE text LIKE '%' || ?1 || '%'
                    AND (?2 IS NULL OR frames.timestamp >= ?2)
                    AND (?3 IS NULL OR frames.timestamp <= ?3)
                "#,
            )
            .bind(query)
            .bind(start_time)
            .bind(end_time)
            .fetch_one(&self.pool)
            .await?;
            total_count += ocr_count.0 as usize;
        }

        if content_type == ContentType::All || content_type == ContentType::Audio {
            let audio_count: (i64,) = sqlx::query_as(
                r#"
                SELECT COUNT(*)
                FROM audio_transcriptions
                WHERE transcription LIKE '%' || ?1 || '%'
                    AND (?2 IS NULL OR timestamp >= ?2)
                    AND (?3 IS NULL OR timestamp <= ?3)
                "#,
            )
            .bind(query)
            .bind(start_time)
            .bind(end_time)
            .fetch_one(&self.pool)
            .await?;
            total_count += audio_count.0 as usize;
        }

        Ok(total_count)
    }
    pub async fn count_recent_results(
        &self,
        start_timestamp: Option<DateTime<Utc>>,
        end_timestamp: Option<DateTime<Utc>>,
    ) -> Result<usize, sqlx::Error> {
        let mut total_count = 0;

        let ocr_count: (i64,) = sqlx::query_as(
            r#"
            SELECT COUNT(*)
            FROM frames
            JOIN ocr_text ON frames.id = ocr_text.frame_id
            WHERE 
                (?1 IS NULL OR frames.timestamp >= ?1)
                AND (?2 IS NULL OR frames.timestamp <= ?2)
            "#,
        )
        .bind(start_timestamp)
        .bind(end_timestamp)
        .fetch_one(&self.pool)
        .await?;

        total_count += ocr_count.0 as usize;

        let audio_count: (i64,) = sqlx::query_as(
            r#"
            SELECT COUNT(*)
            FROM audio_transcriptions
            WHERE 
                (?1 IS NULL OR timestamp >= ?1)
                AND (?2 IS NULL OR timestamp <= ?2)
            "#,
        )
        .bind(start_timestamp)
        .bind(end_timestamp)
        .fetch_one(&self.pool)
        .await?;

        total_count += audio_count.0 as usize;

        Ok(total_count)
    }
}

impl Clone for DatabaseManager {
    fn clone(&self) -> Self {
        DatabaseManager {
            pool: self.pool.clone(),
        }
    }
}

