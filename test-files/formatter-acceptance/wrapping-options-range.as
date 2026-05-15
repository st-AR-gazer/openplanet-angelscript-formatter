void Before(){int untouched=1+2;}

void Main(){
  int seed=1+2;
  DoSomethingLong(alpha,beta,gamma,delta,epsilon);
  obj.Manager.Component.Run().WithValue(seed).Apply();
}

void After(){int untouched=3+4;}
