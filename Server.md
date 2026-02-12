0) 공통 변수(원하는 값으로 변경)
export APP_DIR=/home/ubuntu/apps/VulnCheckList
export APP_USER=ubuntu
1) 기본 패키지
sudo apt update
sudo apt install -y git curl unzip build-essential ca-certificates software-properties-common
2) Python 3.11 + venv
sudo add-apt-repository -y ppa:deadsnakes/ppa
sudo apt update
sudo apt install -y python3.11 python3.11-venv python3.11-dev
3) Go 1.24 설치
cd /tmp
curl -LO https://go.dev/dl/go1.24.0.linux-amd64.tar.gz
sudo rm -rf /usr/local/go
sudo tar -C /usr/local -xzf go1.24.0.linux-amd64.tar.gz
echo 'export PATH=$PATH:/usr/local/go/bin:$HOME/go/bin' >> ~/.bashrc
source ~/.bashrc
4) subfinder/httpx 설치
go install -v github.com/projectdiscovery/subfinder/v2/cmd/subfinder@latest
go install -v github.com/projectdiscovery/httpx/cmd/httpx@latest
5) Redis 설치(잡 큐용)
sudo apt install -y redis-server
sudo systemctl enable --now redis-server
redis-cli ping
6) Postgres 설치(결과 저장용)
sudo apt install -y postgresql postgresql-contrib
sudo systemctl enable --now postgresql
7) 프로젝트 배포
mkdir -p ~/apps
cd ~/apps
git clone <YOUR_REPO_URL> VulnCheckList
cd VulnCheckList
python3.11 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
8) 환경변수 파일(.env 예시)
cat <<'EOF' > $APP_DIR/.env
# 기본 실행
TARGETS_FILE=/home/ubuntu/apps/VulnCheckList/data/subdomains.txt
# 로그인 옵션(선택)
LOGIN_ENABLED=false
LOGIN_USER=
LOGIN_PASSWORD=
LOGIN_PATH=/api/auth/login
LOGOUT_PATH=/api/auth/logout
VERIFY_SSL=true
# 병렬 처리(선택)
DOMAIN_WORKERS=10
PAGE_WORKERS=10
# 큐/DB(선택)
REDIS_URL=redis://127.0.0.1:6379/0
DATABASE_URL=postgresql://vulncheck:password@127.0.0.1:5432/vulncheck
EOF
9) (선택) Postgres 사용자/DB 생성
sudo -u postgres psql <<'EOF'
CREATE USER vulncheck WITH PASSWORD 'password';
CREATE DATABASE vulncheck OWNER vulncheck;
EOF
10) 단일 실행(테스트)
source $APP_DIR/venv/bin/activate
python3.11 $APP_DIR/main.py $APP_DIR/data/subdomains.txt
11) 워커/오케스트레이터 systemd 등록
> 병렬 워커는 현재 코드에 별도 워커 스크립트가 없으므로, 아래는 기본 실행 서비스 예시입니다.
sudo tee /etc/systemd/system/vulncheck.service >/dev/null <<'EOF'
[Unit]
Description=VulnCheck Runner
After=network.target redis-server.service postgresql.service
[Service]
User=ubuntu
WorkingDirectory=/home/ubuntu/apps/VulnCheckList
EnvironmentFile=/home/ubuntu/apps/VulnCheckList/.env
Environment=PATH=/home/ubuntu/apps/VulnCheckList/venv/bin:/usr/local/go/bin:/home/ubuntu/go/bin:/usr/bin
ExecStart=/home/ubuntu/apps/VulnCheckList/venv/bin/python3.11 /home/ubuntu/apps/VulnCheckList/main.py ${TARGETS_FILE}
Restart=on-failure
[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now vulncheck.service
12) 파일 디스크립터 상향
ulimit -n 65535
13) UFW 방화벽(필요 시)
sudo ufw allow OpenSSH
sudo ufw enable
