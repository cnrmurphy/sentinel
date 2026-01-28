mod agent;
mod cli;
mod event;
mod parsers;
mod proxy;
mod sse;
mod storage;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    cli::run().await
}
