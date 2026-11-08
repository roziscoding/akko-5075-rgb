mod keyboard;
mod protocol;

use anyhow::{Result, bail};
use clap::{Args, Parser, Subcommand, ValueEnum};

use keyboard::Keyboard;
use protocol::{Changes, ColorChange, Effect, LedParam, MAX_LEVEL, Rgb, Zone};

/// Control the RGB lighting of the Akko 5075 keyboard.
///
/// Only the settings you pass change; everything else stays as it is.
#[derive(Parser)]
#[command(name = "akko-rgb", version)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Show the current lighting of each zone
    Status,
    /// List the available effects
    Effects,
    /// Set a solid color
    Color {
        /// Color as RRGGBB, with or without a leading #
        color: Rgb,
        #[command(flatten)]
        target: Target,
    },
    /// Change the effect, color, speed or brightness
    Set(SetArgs),
    /// Turn the lighting off
    Off {
        #[command(flatten)]
        target: Target,
    },
}

#[derive(Args)]
struct Target {
    /// Zone to change
    #[arg(short, long, value_enum, default_value_t = ZoneArg::All)]
    zone: ZoneArg,
}

#[derive(Clone, Copy, ValueEnum)]
enum ZoneArg {
    All,
    Keys,
    Side,
}

#[derive(Args)]
struct SetArgs {
    #[command(flatten)]
    settings: Settings,
    #[command(flatten)]
    target: Target,
}

#[derive(Args)]
#[group(required = true, multiple = true)]
struct Settings {
    /// Effect name, see `akko-rgb effects`
    #[arg(short, long, value_parser = protocol::effect_by_name)]
    effect: Option<&'static Effect>,
    /// Color as RRGGBB, with or without a leading #
    #[arg(short, long, conflicts_with = "rainbow")]
    color: Option<Rgb>,
    /// Cycle through rainbow colors instead of a fixed color
    #[arg(short, long)]
    rainbow: bool,
    /// Effect speed, from 0 (slowest) to 4 (fastest)
    #[arg(short, long, value_parser = clap::value_parser!(u8).range(0..=MAX_LEVEL as i64))]
    speed: Option<u8>,
    /// Brightness, from 0 to 4
    #[arg(short, long, value_parser = clap::value_parser!(u8).range(0..=MAX_LEVEL as i64))]
    brightness: Option<u8>,
}

impl From<Settings> for Changes {
    fn from(settings: Settings) -> Self {
        let color = if settings.rainbow {
            Some(ColorChange::Rainbow)
        } else {
            settings.color.map(ColorChange::Rgb)
        };

        Changes {
            effect: settings.effect,
            color,
            speed: settings.speed,
            brightness: settings.brightness,
        }
    }
}

const ALL_ZONES: [Zone; 2] = [Zone::Keys, Zone::Side];

fn zones(target: &Target) -> &'static [Zone] {
    match target.zone {
        ZoneArg::All => &ALL_ZONES,
        ZoneArg::Keys => &ALL_ZONES[..1],
        ZoneArg::Side => &ALL_ZONES[1..],
    }
}

fn named_effect(name: &str) -> Result<&'static Effect> {
    protocol::effect_by_name(name).map_err(anyhow::Error::msg)
}

fn main() -> Result<()> {
    match Cli::parse().command {
        Command::Status => status(),
        Command::Effects => {
            effects();
            Ok(())
        }
        Command::Color { color, target } => update(
            &target,
            Changes {
                effect: Some(named_effect("constant")?),
                color: Some(ColorChange::Rgb(color)),
                ..Changes::default()
            },
        ),
        Command::Set(args) => update(&args.target, args.settings.into()),
        Command::Off { target } => update(
            &target,
            Changes {
                effect: Some(named_effect("off")?),
                ..Changes::default()
            },
        ),
    }
}

fn status() -> Result<()> {
    let keyboard = Keyboard::open()?;

    for zone in ALL_ZONES {
        let Some(param) = keyboard.read(zone)? else {
            println!("{:<5} (no response)", zone.label());
            continue;
        };

        println!(
            "{:<5} {:<13} {:<10} speed {}/{MAX_LEVEL}  brightness {}/{MAX_LEVEL}",
            zone.label(),
            protocol::effect_label(param.mode),
            param.source_label(),
            param.ui_speed(zone),
            param.brightness,
        );
    }

    Ok(())
}

fn effects() {
    for effect in protocol::EFFECTS {
        let suffix = if protocol::side_supports(effect) {
            ""
        } else {
            "  (keys only)"
        };

        println!("{}{suffix}", effect.name);
    }
}

fn update(target: &Target, changes: Changes) -> Result<()> {
    let keyboard = Keyboard::open()?;

    for &zone in zones(target) {
        let current = keyboard.read(zone)?.unwrap_or_else(|| {
            eprintln!(
                "warning: no response from the {} zone, using defaults",
                zone.label()
            );
            LedParam::FALLBACK
        });

        match protocol::apply(zone, current, &changes) {
            Some(next) => keyboard.write(zone, &next)?,
            None if matches!(target.zone, ZoneArg::Side) => {
                bail!("the side bars do not support this effect");
            }
            None => eprintln!("note: the side bars do not support this effect, left unchanged"),
        }
    }

    Ok(())
}
