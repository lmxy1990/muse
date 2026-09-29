import argparse
import json
import os
import subprocess
import sys
import urllib.request


PM2S_REPO = "https://github.com/cheriell/PM2S.git"
PM2S_MODELS = {
    "beat/RNNJointBeatModel.pth": "https://zenodo.org/records/10520196/files/RNNJointBeatModel.pth?download=1",
    "quantisation/RNNJointQuantisationModel.pth": "https://zenodo.org/records/10520196/files/RNNJointQuantisationModel.pth?download=1",
    "hand_part/RNNHandPartModel.pth": "https://zenodo.org/records/10520196/files/RNNHandPartModel.pth?download=1",
    "key_signature/RNNKeySignatureModel.pth": "https://zenodo.org/records/10520196/files/RNNKeySignatureModel.pth?download=1",
    "time_signature/CNNTimeSignatureModel.pth": "https://zenodo.org/records/10520196/files/CNNTimeSignatureModel.pth?download=1",
}


def progress(percent, message):
    print(json.dumps({"stage": "setup", "percent": percent, "message": message}), file=sys.stderr, flush=True)


def run(command, label, percent):
    progress(percent, f"Installing {label}")
    completed = subprocess.run(command, text=True, capture_output=True)
    if completed.returncode != 0:
        detail = (completed.stderr or completed.stdout or "").strip()
        raise RuntimeError(f"{label} failed: {detail[-2000:]}")


def install_dependencies(requirements):
    run([sys.executable, "-m", "pip", "install", "--upgrade", "pip"], "pip", 5)
    run([sys.executable, "-m", "pip", "install", "-r", requirements], "dependencies", 10)


def install_pm2s(pm2s_dir):
    pm2s_dir = os.path.abspath(pm2s_dir)
    if not os.path.isdir(os.path.join(pm2s_dir, "pm2s")):
        os.makedirs(os.path.dirname(pm2s_dir), exist_ok=True)
        run(["git", "clone", "--depth", "1", PM2S_REPO, pm2s_dir], "PM2S", 72)

    models_dir = os.path.join(pm2s_dir, "pm2s", "_model_state_dicts")
    for index, (relative_path, url) in enumerate(PM2S_MODELS.items()):
        destination = os.path.join(models_dir, relative_path)
        if os.path.isfile(destination) and os.path.getsize(destination) > 0:
            continue
        os.makedirs(os.path.dirname(destination), exist_ok=True)
        progress(76 + index * 4, f"Downloading PM2S model {index + 1}/{len(PM2S_MODELS)}")
        try:
            urllib.request.urlretrieve(url, destination)
        except Exception:
            if os.path.exists(destination):
                os.remove(destination)
            raise


def main():
    parser = argparse.ArgumentParser(description="Prepare Muse's local Python environment")
    parser.add_argument("--requirements", required=True)
    parser.add_argument("--pm2s-dir", required=True)
    args = parser.parse_args()

    progress(1, "Preparing Python environment")
    install_dependencies(os.path.abspath(args.requirements))
    install_pm2s(args.pm2s_dir)
    progress(100, "Python environment ready")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
